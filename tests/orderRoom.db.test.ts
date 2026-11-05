import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { expertAvailable, fundMilestone } from "@/server/escrow";
import { checkUpload, FileError, getFileForUser, saveUploads } from "@/server/files";
import {
  approveDelivery,
  autoApproveDue,
  expertReviewSummary,
  leaveReview,
  listMessages,
  looksLikeContactDetails,
  OrderRoomError,
  requestRevision,
  sendMessage,
  submitDelivery,
} from "@/server/orderRoom";
import { createOrderFromService } from "@/server/orders";
import { saveService } from "@/server/services";
import { approveApplication, submitApplication } from "@/server/vetting";

let db: DB;
let expert: string, client: string, orderId: string, milestoneId: string;

const file = (name: string, size = 2_000) => new File([new Uint8Array(size)], name, { type: "application/octet-stream" });
const order = async () => (await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)))[0];
const milestone = async () => (await db.select().from(schema.milestones).where(eq(schema.milestones.id, milestoneId)))[0];

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [e] = await d.insert(schema.users).values({ email: "cosmos@example.com", name: "Cosmos Nabonadam" }).returning();
  const [c] = await d.insert(schema.users).values({ email: "akosua@example.com", name: "Akosua Mensah" }).returning();
  expert = e.id;
  client = c.id;
  const app = await submitApplication(db, expert, { qualification: "PhD candidate", fields: ["Statistics & data analysis"], experienceYears: 5, pitch: "p".repeat(90), cvUrl: "https://x.org/cv" });
  await approveApplication(db, { applicationId: app.id });
  const [cat] = await d.select().from(schema.categories).limit(1);
  const serviceId = await saveService(db, expert, {
    title: "Regression analysis in Stata",
    categoryId: cat.id,
    description: "d".repeat(130),
    requirements: [],
    tiers: [{ name: "BASIC", priceMinor: 100_000, deliveryDays: 5, revisions: 1, includes: [] }],
  });
  const created = await createOrderFromService(db, { clientId: client, serviceId, tier: "BASIC", answers: [], feeBps: 1500 });
  orderId = created.order.id;
  milestoneId = created.milestone.id;
  await fundMilestone(db, { milestoneId, amountMinor: 100_000, currency: "GHS", reference: "ps_1" });
});

describe("files", () => {
  it("rejects unsupported and oversized uploads", () => {
    expect(() => checkUpload("virus.exe", 100)).toThrow(FileError);
    expect(() => checkUpload("huge.pdf", 11 * 1024 * 1024)).toThrow(/10 MB/);
    expect(() => checkUpload("analysis.do", 500)).not.toThrow();
  });

  it("only order participants (or admins) can download", async () => {
    const [id] = await saveUploads(db, { orderId, ownerId: expert, uploads: [file("results.pdf")] });
    expect(await getFileForUser(db, id, { id: client, roles: ["CLIENT"] })).not.toBeNull();
    expect(await getFileForUser(db, id, { id: "stranger", roles: ["CLIENT"] })).toBeNull();
    expect(await getFileForUser(db, id, { id: "admin", roles: ["ADMIN"] })).not.toBeNull();
  });
});

describe("messages", () => {
  it("participants can message; outsiders can't; contact details are flagged", async () => {
    await sendMessage(db, { orderId, senderId: client, body: "Hello! Dataset attached soon." });
    await expect(sendMessage(db, { orderId, senderId: "stranger", body: "hi" })).rejects.toThrow(OrderRoomError);
    await sendMessage(db, { orderId, senderId: expert, body: "Reach me on +233 24 123 4567" });
    expect((await listMessages(db, orderId)).map((m) => m.senderName)).toEqual(["Akosua Mensah", "Cosmos Nabonadam"]);
    const flagged = await db.select().from(schema.messages).where(eq(schema.messages.flagged, true));
    expect(flagged).toHaveLength(1);
    expect(looksLikeContactDetails("email me at a.b@uni.edu.gh")).toBe(true);
    expect(looksLikeContactDetails("Model 2 has 1,204 observations")).toBe(false);
  });
});

describe("delivery lifecycle", () => {
  it("deliver → revision → deliver → approve releases escrow and completes the order", async () => {
    await expect(submitDelivery(db, { milestoneId, expertId: client, note: "x", fileIds: ["f"] })).rejects.toThrow(/expert/);
    const f1 = await saveUploads(db, { orderId, ownerId: expert, uploads: [file("v1.pdf")] });
    await submitDelivery(db, { milestoneId, expertId: expert, note: "First draft of results", fileIds: f1 });
    expect((await order()).status).toBe("DELIVERED");
    expect((await milestone()).autoApproveAt).not.toBeNull();

    await requestRevision(db, { milestoneId, clientId: client, reason: "Please add robustness checks" });
    expect((await milestone()).status).toBe("REVISION_REQUESTED");
    expect((await order()).status).toBe("ACTIVE");

    const f2 = await saveUploads(db, { orderId, ownerId: expert, uploads: [file("v2.pdf")] });
    await submitDelivery(db, { milestoneId, expertId: expert, note: "Added robustness checks", fileIds: f2 });
    await expect(requestRevision(db, { milestoneId, clientId: client, reason: "More" })).rejects.toThrow(/used all/);
    await expect(approveDelivery(db, { milestoneId, clientId: expert })).rejects.toThrow();

    await approveDelivery(db, { milestoneId, clientId: client });
    expect((await order()).status).toBe("COMPLETED");
    expect(await expertAvailable(db, expert)).toBe(85_000);
  });

  it("auto-approves deliveries the client ignores", async () => {
    const f = await saveUploads(db, { orderId, ownerId: expert, uploads: [file("final.pdf")] });
    await submitDelivery(db, { milestoneId, expertId: expert, note: "Final", fileIds: f });
    expect((await autoApproveDue(db)).approved).toBe(0); // not due yet
    const later = new Date(Date.now() + 4 * 86_400_000);
    await db.update(schema.milestones).set({ autoApproveAt: new Date(Date.now() - 1000) }).where(eq(schema.milestones.id, milestoneId));
    expect((await autoApproveDue(db, later)).approved).toBe(1);
    expect((await order()).status).toBe("COMPLETED");
    expect((await autoApproveDue(db, later)).approved).toBe(0); // idempotent
  });
});

describe("reviews", () => {
  it("both sides review once after completion; the expert's average reflects client reviews only", async () => {
    await expect(leaveReview(db, { orderId, authorId: client, rating: 5, body: "Great" })).rejects.toThrow(/completed/);
    const f = await saveUploads(db, { orderId, ownerId: expert, uploads: [file("final.pdf")] });
    await submitDelivery(db, { milestoneId, expertId: expert, note: "Final", fileIds: f });
    await approveDelivery(db, { milestoneId, clientId: client });

    await leaveReview(db, { orderId, authorId: client, rating: 5, body: "Clear, fast and thorough." });
    await expect(leaveReview(db, { orderId, authorId: client, rating: 4, body: "" })).rejects.toThrow(/already/);
    await leaveReview(db, { orderId, authorId: expert, rating: 4, body: "Well-prepared client." });
    await expect(leaveReview(db, { orderId, authorId: "stranger", rating: 5, body: "" })).rejects.toThrow();

    const summary = await expertReviewSummary(db, expert);
    expect(summary.total).toBe(1);
    expect(summary.average).toBe(5);
    expect(summary.recent[0].author).toBe("Akosua Mensah");
  });
});
