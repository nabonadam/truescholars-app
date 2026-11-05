import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { fundMilestone } from "@/server/escrow";
import { createOrderFromService, getOrderForUser, OrderError } from "@/server/orders";
import { getService, saveService, searchServices, ServiceError, setServiceStatus, validateTiers, type ServiceInput } from "@/server/services";
import { approveApplication, submitApplication } from "@/server/vetting";

let db: DB;
let expertId: string;
let clientId: string;
let statsCat: string;

const base = (categoryId: string): ServiceInput => ({
  title: "I will run and interpret regression analysis in Stata",
  categoryId,
  description: "x".repeat(130),
  requirements: ["What is your research question?"],
  tiers: [
    { name: "BASIC", priceMinor: 100_000, deliveryDays: 5, revisions: 1, includes: ["Up to 2 models"] },
    { name: "STANDARD", priceMinor: 180_000, deliveryDays: 7, revisions: 2, includes: ["Up to 5 models"] },
  ],
});

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [e] = await d.insert(schema.users).values({ email: "cosmos@example.com", name: "Cosmos Nabonadam" }).returning();
  const [c] = await d.insert(schema.users).values({ email: "client@example.com", name: "Akosua" }).returning();
  expertId = e.id;
  clientId = c.id;
  const app = await submitApplication(db, expertId, {
    qualification: "PhD candidate",
    fields: ["Statistics & data analysis"],
    experienceYears: 5,
    pitch: "p".repeat(90),
    cvUrl: "https://example.com/cv",
  });
  await approveApplication(db, { applicationId: app.id });
  const [cat] = await d.select().from(schema.categories).where(eq(schema.categories.slug, "statistics-data-analysis"));
  statsCat = cat.id;
});

describe("categories", () => {
  it("are seeded by migration", async () => {
    const cats = await db.select().from(schema.categories);
    expect(cats).toHaveLength(15);
  });
});

describe("services", () => {
  it("validates packages", () => {
    const t = base(statsCat).tiers;
    expect(() => validateTiers([t[1]])).toThrow(/Basic/);
    expect(() => validateTiers([t[0], { ...t[1], priceMinor: 90_000 }])).toThrow(/cost more/);
    expect(() => validateTiers([{ ...t[0], priceMinor: 500 }])).toThrow(/minimum/);
  });

  it("only experts can create, and search finds active services with a from-price", async () => {
    await expect(saveService(db, clientId, base(statsCat))).rejects.toThrow(ServiceError);
    const id = await saveService(db, expertId, base(statsCat));

    const hits = await searchServices(db, { q: "regression" });
    expect(hits).toHaveLength(1);
    expect(hits[0].fromMinor).toBe(100_000);
    expect(hits[0].fastestDays).toBe(5);
    expect(await searchServices(db, { category: "transcription" })).toHaveLength(0);
    expect(await searchServices(db, { q: "nvivo" })).toHaveLength(0);

    await setServiceStatus(db, expertId, id, "PAUSED");
    expect(await searchServices(db, {})).toHaveLength(0);
  });

  it("editing replaces the packages", async () => {
    const id = await saveService(db, expertId, base(statsCat));
    await saveService(db, expertId, { ...base(statsCat), tiers: [base(statsCat).tiers[0]] }, id);
    const svc = await getService(db, id);
    expect(svc?.tiers.map((t) => t.name)).toEqual(["BASIC"]);
    await expect(saveService(db, clientId, base(statsCat), id)).rejects.toThrow();
  });
});

describe("checkout", () => {
  it("creates an order with one milestone and a thread, then payment funds it", async () => {
    const serviceId = await saveService(db, expertId, base(statsCat));
    await expect(
      createOrderFromService(db, { clientId: expertId, serviceId, tier: "BASIC", answers: [] }),
    ).rejects.toThrow(OrderError);

    const { order, milestone } = await createOrderFromService(db, {
      clientId,
      serviceId,
      tier: "STANDARD",
      answers: [{ question: "What is your research question?", answer: "Does fasting improve metabolic health?" }],
      feeBps: 1500,
    });
    expect(order.totalMinor).toBe(180_000);
    expect(order.status).toBe("AWAITING_PAYMENT");
    expect(milestone.revisionsAllowed).toBe(2);
    const threads = await db.select().from(schema.threadMembers);
    expect(threads).toHaveLength(2);

    await fundMilestone(db, { milestoneId: milestone.id, amountMinor: 180_000, currency: "GHS", reference: "ps_1" });
    const view = await getOrderForUser(db, order.id, clientId);
    expect(view?.order.status).toBe("ACTIVE");
    expect(view?.milestones[0].status).toBe("FUNDED");
    expect(await getOrderForUser(db, order.id, "someone-else")).toBeNull();
  });
});
