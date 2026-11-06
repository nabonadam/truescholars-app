import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { accessFor, canRun, endAccess, grantAccess, listStatsUsers, timeLeft } from "@/server/statsAccess";

let db: DB;
let user: { id: string; roles: string[] };
const H = 3_600_000;
const t0 = new Date("2026-11-06T12:00:00Z");
const at = (hours: number) => new Date(t0.getTime() + hours * H);

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [u] = await d.insert(schema.users).values({ email: "kofi@example.com", name: "Kofi Asante" }).returning();
  user = { id: u.id, roles: ["CLIENT"] };
});

describe("Statistics Assistant free trial", () => {
  it("starts on the first visit and lasts two days", async () => {
    const a = await accessFor(db, user, t0);
    expect(a).toEqual({ kind: "trial", endsAt: at(48) });
    expect(await accessFor(db, user, at(30))).toEqual({ kind: "trial", endsAt: at(48) }); // the clock does not restart
    const ended = await accessFor(db, user, at(49));
    expect(ended.kind).toBe("ended");
    expect(canRun(ended)).toBe(false);
  });

  it("admins are never limited", async () => {
    expect(await accessFor(db, { ...user, roles: ["CLIENT", "ADMIN"] }, at(1000))).toEqual({ kind: "admin" });
  });

  it("granted time starts after the trial or now, whichever is later, and can be ended", async () => {
    await accessFor(db, user, t0);
    const g = await grantAccess(db, "KOFI@example.com ", 30, "Paid by MoMo", at(10));
    expect(g.until).toEqual(at(48 + 30 * 24)); // added after the unused trial
    expect(await accessFor(db, user, at(100))).toEqual({ kind: "granted", endsAt: at(48 + 720) });
    await grantAccess(db, "kofi@example.com", 1, undefined, at(100));
    expect((await accessFor(db, user, at(100))) as { endsAt: Date }).toMatchObject({ endsAt: at(48 + 744) });
    const [row] = await listStatsUsers(db, "kofi");
    expect(row).toMatchObject({ email: "kofi@example.com", note: "Paid by MoMo", runs: 0 });
    await endAccess(db, user.id);
    expect((await accessFor(db, user)).kind).toBe("ended");
    await expect(grantAccess(db, "nobody@example.com", 5)).rejects.toThrow(/No account/);
  });

  it("says how long is left in plain words", () => {
    expect(timeLeft(at(38), t0)).toBe("1 day 14 hours");
    expect(timeLeft(at(48), t0)).toBe("2 days");
    expect(timeLeft(at(5), t0)).toBe("5 hours");
    expect(timeLeft(new Date(at(48).getTime() - 60_000), t0)).toBe("2 days");
    expect(timeLeft(new Date(t0.getTime() + 12 * 60_000), t0)).toBe("12 minutes");
  });
});
