import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { consumeToken, createToken, resetPassword, tokenValid, verifyEmail } from "@/server/authTokens";
import { hit, readBody, sweepLimits } from "@/server/rateLimit";

let db: DB;
let userId: string;
beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [u] = await d.insert(schema.users).values({ email: "yaa@example.com", name: "Yaa", passwordHash: "old" }).returning();
  userId = u.id;
});

describe("rate limits", () => {
  it("allows up to the limit in a window, then refuses until it resets", async () => {
    const t0 = new Date();
    for (let i = 0; i < 3; i++) expect(await hit(db, "k", 3, 60, t0)).toBe(true);
    expect(await hit(db, "k", 3, 60, t0)).toBe(false);
    expect(await hit(db, "k", 3, 60, new Date(t0.getTime() + 61_000))).toBe(true); // new window
    await sweepLimits(db, new Date(t0.getTime() + 999_999));
    expect(await db.select().from(schema.rateLimits)).toHaveLength(0);
  });

  it("reads bodies only up to a maximum", async () => {
    const small = new Request("http://x/", { method: "POST", body: new Uint8Array(10) });
    expect((await readBody(small, 100))!.byteLength).toBe(10);
    const big = new Request("http://x/", { method: "POST", body: new Uint8Array(1000) });
    expect(await readBody(big, 100)).toBeNull();
    // no declared size: still cut off at the maximum
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(50)); c.close(); } });
    const chunked = new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readBody(chunked, 100)).toBeNull();
  });
});

describe("email links", () => {
  it("resets a password once, signs out other sessions and proves the email", async () => {
    const token = await createToken(db, userId, "reset");
    const [row] = await db.select().from(schema.authTokens);
    expect(row.tokenHash).not.toContain(token); // only a hash is stored
    expect(await tokenValid(db, token, "reset")).toBe(true);
    expect(await tokenValid(db, token, "verify")).toBe(false); // the wrong kind
    expect(await resetPassword(db, token, "new-hash")).toBe(true);
    expect(await resetPassword(db, token, "again")).toBe(false); // works once
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(u).toMatchObject({ passwordHash: "new-hash", sessionVersion: 1 });
    expect(u.emailVerified).not.toBeNull();
  });

  it("expires links, and a new one replaces the old", async () => {
    const old = await createToken(db, userId, "verify");
    const fresh = await createToken(db, userId, "verify");
    expect(await verifyEmail(db, old)).toBe(false);
    expect(await consumeToken(db, fresh, "verify", new Date(Date.now() + 4 * 86_400_000))).toBeNull(); // after 3 days
    expect(await verifyEmail(db, fresh)).toBe(true);
    expect(await verifyEmail(db, "not-a-real-token-at-all-xxxxxx")).toBe(false);
  });
});
