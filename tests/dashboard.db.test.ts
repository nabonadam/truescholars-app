import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { attentionItems, progressStep } from "@/server/dashboard";
import { fundMilestone } from "@/server/escrow";
import { saveUploads } from "@/server/files";
import { listNotifications, markOrderNotificationsRead, unreadNotificationCount } from "@/server/notifications";
import { approveDelivery, listConversations, markThreadRead, orderPulse, sendMessage, submitDelivery, unreadByOrder } from "@/server/orderRoom";
import { createOrderFromService } from "@/server/orders";
import { saveService } from "@/server/services";
import { approveApplication, submitApplication } from "@/server/vetting";

let db: DB;
let expert: string, client: string, orderId: string, milestoneId: string;

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [e] = await d.insert(schema.users).values({ email: "cosmos@example.com", name: "Cosmos Nabonadam" }).returning();
  const [c] = await d.insert(schema.users).values({ email: "akosua@example.com", name: "Akosua Mensah" }).returning();
  expert = e.id;
  client = c.id;
  const app = await submitApplication(db, expert, { qualification: "PhD", fields: ["Qualitative analysis"], experienceYears: 4, pitch: "p".repeat(90), cvUrl: "https://x.org/cv" });
  await approveApplication(db, { applicationId: app.id });
  const [cat] = await d.select().from(schema.categories).limit(1);
  const serviceId = await saveService(db, expert, {
    title: "Qualitative Analysis with NVivo",
    categoryId: cat.id,
    description: "d".repeat(130),
    requirements: [],
    tiers: [{ name: "BASIC", priceMinor: 50_000, deliveryDays: 5, revisions: 1, includes: [] }],
  });
  const created = await createOrderFromService(db, { clientId: client, serviceId, tier: "BASIC", answers: [], feeBps: 1500 });
  orderId = created.order.id;
  milestoneId = created.milestone.id;
});

describe("attention items", () => {
  it("guide each side through the order", async () => {
    expect((await attentionItems(db, client)).map((a) => a.key)).toEqual([`pay-${orderId}`]);
    expect(await attentionItems(db, expert)).toEqual([]);

    await fundMilestone(db, { milestoneId, amountMinor: 50_000, currency: "GHS", reference: "ps_1" });
    expect(await attentionItems(db, client)).toEqual([]);
    const exp = await attentionItems(db, expert);
    expect(exp[0].title).toContain("Deliver");
    expect(exp[0].detail).toMatch(/Due in 5 days/);

    const [f] = await saveUploads(db, { orderId, ownerId: expert, uploads: [new File([new Uint8Array(10)], "codes.pdf")] });
    await submitDelivery(db, { milestoneId, expertId: expert, note: "Codebook and themes", fileIds: [f] });
    const cli = await attentionItems(db, client);
    expect(cli[0]).toMatchObject({ urgent: true, cta: "Review" });
    expect(cli[0].detail).toMatch(/automatically in 3 days/);

    await approveDelivery(db, { milestoneId, clientId: client });
    expect((await attentionItems(db, client)).map((a) => a.cta)).toEqual(["Rate"]);
  });

  it("progress steps", () => {
    expect(progressStep("AWAITING_PAYMENT", ["PENDING_FUNDING"])).toBe(-1);
    expect(progressStep("ACTIVE", ["FUNDED"])).toBe(1);
    expect(progressStep("DELIVERED", ["DELIVERED"])).toBe(2);
    expect(progressStep("COMPLETED", ["APPROVED"])).toBe(3);
  });
});

describe("unread messages and notifications", () => {
  it("counts unread per order until the order is opened", async () => {
    await sendMessage(db, { orderId, senderId: expert, body: "Hi Akosua, could you share the transcripts?" });
    await sendMessage(db, { orderId, senderId: expert, body: "Also the interview guide." });
    expect((await unreadByOrder(db, client)).get(orderId)).toBe(2);
    expect((await unreadByOrder(db, expert)).get(orderId)).toBeUndefined();
    expect((await attentionItems(db, client)).some((a) => a.title === "2 new messages from Cosmos")).toBe(true);

    expect(await unreadNotificationCount(db, client)).toBe(2);
    await markThreadRead(db, orderId, client);
    await markOrderNotificationsRead(db, client, orderId);
    expect((await unreadByOrder(db, client)).get(orderId)).toBeUndefined();
    expect(await unreadNotificationCount(db, client)).toBe(0);
  });

  it("notifies the right person at each step", async () => {
    await fundMilestone(db, { milestoneId, amountMinor: 50_000, currency: "GHS", reference: "ps_1" });
    const [f] = await saveUploads(db, { orderId, ownerId: expert, uploads: [new File([new Uint8Array(10)], "report.pdf")] });
    await submitDelivery(db, { milestoneId, expertId: expert, note: "Report", fileIds: [f] });
    await approveDelivery(db, { milestoneId, clientId: client });

    const expertKinds = (await listNotifications(db, expert)).map((n) => n.kind).sort();
    const clientKinds = (await listNotifications(db, client)).map((n) => n.kind).sort();
    expect(expertKinds).toEqual(["APPLICATION_DECIDED", "ORDER_PAID", "PAYMENT_RELEASED"]);
    expect(clientKinds).toEqual(["DELIVERED"]);
    const paid = (await listNotifications(db, expert)).find((n) => n.kind === "PAYMENT_RELEASED");
    expect(paid?.body).toContain("GH₵425.00"); // 500 − 15%
  });
});

describe("inbox and live updates", () => {
  it("lists conversations with the latest message and unread count", async () => {
    expect((await listConversations(db, client))[0].last).toBeNull();
    await sendMessage(db, { orderId, senderId: client, body: "Hello Cosmos" });
    await sendMessage(db, { orderId, senderId: expert, body: "Hi Akosua, received." });
    const [c] = await listConversations(db, client);
    expect(c).toMatchObject({ otherName: "Cosmos Nabonadam", role: "buying", unread: 1 });
    expect(c.last).toMatchObject({ body: "Hi Akosua, received.", mine: false });
    const [e] = await listConversations(db, expert);
    expect(e).toMatchObject({ otherName: "Akosua Mensah", role: "selling", unread: 1 });
    expect(await listConversations(db, "stranger")).toEqual([]);
  });

  it("the pulse changes when a message arrives or status changes, and not otherwise", async () => {
    const a = await orderPulse(db, orderId);
    expect(await orderPulse(db, orderId)).toBe(a);
    await sendMessage(db, { orderId, senderId: expert, body: "Quick question" });
    const b = await orderPulse(db, orderId);
    expect(b).not.toBe(a);
    await fundMilestone(db, { milestoneId, amountMinor: 50_000, currency: "GHS", reference: "ps_9" });
    expect(await orderPulse(db, orderId)).not.toBe(b);
  });
});
