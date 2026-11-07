import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { runHourly } from "@/server/cron";
import { createReview } from "@/server/lit";
import { assignRetriever, requestRetrieval } from "@/server/litRetrieval";
import { toolAccessFor } from "@/server/toolAccess";
import { approveApplication, submitApplication } from "@/server/vetting";

let db: DB;
let client: { id: string; roles: string[] }, expert: string, admin: string;
const H = 3_600_000;
const titles = async (userId: string) => (await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId))).map((n) => n.title);

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [c] = await d.insert(schema.users).values({ email: "c@example.com", name: "Client" }).returning();
  const [e] = await d.insert(schema.users).values({ email: "e@example.com", name: "Expert" }).returning();
  const [a] = await d.insert(schema.users).values({ email: "a@example.com", name: "Admin", roles: ["CLIENT", "ADMIN"] }).returning();
  client = { id: c.id, roles: c.roles };
  expert = e.id;
  admin = a.id;
  const app = await submitApplication(db, expert, { qualification: "PhD", fields: ["Sociology"], experienceYears: 5, pitch: "p".repeat(90), cvUrl: "https://x.org/cv", litRetriever: true });
  await approveApplication(db, { applicationId: app.id });
});

describe("the hourly job", () => {
  it("warns the day before a free trial ends, once", async () => {
    const start = new Date();
    await toolAccessFor(db, "lit", client, start);
    await runHourly(db, new Date(start.getTime() + 12 * H)); // 36 h left: too early
    expect(await titles(client.id)).toEqual([]);
    await runHourly(db, new Date(start.getTime() + 30 * H)); // 18 h left
    await runHourly(db, new Date(start.getTime() + 31 * H));
    expect(await titles(client.id)).toEqual(["Your Literature Review free trial ends tomorrow"]);
  });

  it("nudges an unpaid client after 2 days, tells admins after 5, and warns the expert of the deadline", async () => {
    const id = await createReview(db, client.id, { title: "Rainfall", researchQuestion: "How do farmers adapt to rainfall variability?" });
    await requestRetrieval(db, client.id, id, { brief: {}, days: 3 });
    const order = await assignRetriever(db, id, { expertUserId: expert, priceMinor: 20_000, days: 3 });
    const before = (await titles(client.id)).length;
    const now = Date.now();
    await runHourly(db, new Date(now + 49 * H));
    expect((await titles(client.id)).slice(before)).toEqual(["Your literature expert is waiting to start “Rainfall”"]);
    await runHourly(db, new Date(now + 121 * H));
    expect(await titles(admin)).toContain("Unpaid for 5 days: “Rainfall”");
    expect((await titles(client.id)).slice(before)).toHaveLength(1); // not repeated

    // paid: due date 3 days out, so the expert hears 2+ days later
    await db.update(schema.milestones).set({ status: "FUNDED", dueAt: new Date(now + 72 * H) }).where(eq(schema.milestones.orderId, order.id));
    await runHourly(db, new Date(now + 60 * H));
    expect(await titles(expert)).toContain("Due tomorrow: literature for “Rainfall”");
  });
});
