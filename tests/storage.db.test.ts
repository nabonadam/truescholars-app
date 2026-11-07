import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { checkStorage, deleteAudio, getAudio, moveToR2, putAudio } from "@/server/qualStorage";

let db: DB;
const bucket = new Map<string, { body: Uint8Array; type: string }>();

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  bucket.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A tiny in-memory stand-in for R2's S3 API. */
function fakeR2() {
  vi.stubEnv("R2_ACCOUNT_ID", "acc");
  vi.stubEnv("R2_ACCESS_KEY_ID", "key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("R2_BUCKET", "files");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/files\//, ""));
    if (req.method === "PUT") {
      bucket.set(key, { body: new Uint8Array(await req.arrayBuffer()), type: req.headers.get("content-type") ?? "" });
      return new Response(null, { status: 200 });
    }
    if (req.method === "DELETE") {
      bucket.delete(key);
      return new Response(null, { status: 204 });
    }
    const f = bucket.get(key);
    return f ? new Response(f.body as BodyInit, { status: 200, headers: { "content-type": f.type } }) : new Response("NoSuchKey", { status: 404 });
  });
}

describe("switching file storage to R2", () => {
  it("keeps finding files saved before the switch, and moves them across", async () => {
    await putAudio(db, "lit/r1/p1.pdf", new Uint8Array([1, 2, 3]), "application/pdf"); // saved in the database
    await putAudio(db, "qual/s1/a.webm", new Uint8Array([4, 5]), "audio/webm");
    fakeR2();
    expect(await checkStorage()).toMatchObject({ storage: "r2", ok: true });
    // read: served from the database and copied into R2
    expect(await getAudio(db, "lit/r1/p1.pdf")).toEqual({ bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" });
    expect(bucket.has("lit/r1/p1.pdf")).toBe(true);
    // the hourly job moves the rest
    expect(await moveToR2(db)).toEqual({ moved: 1, left: 0, storage: "r2" });
    expect(await getAudio(db, "qual/s1/a.webm")).toEqual({ bytes: new Uint8Array([4, 5]), mimeType: "audio/webm" });
    // new files go straight to R2; deletes reach R2
    await putAudio(db, "qual/s1/b.webm", new Uint8Array([9]), "audio/webm");
    expect((await db.select().from(schema.qualAudio)).length).toBe(0);
    await deleteAudio(db, "qual/s1/b.webm");
    expect(await getAudio(db, "qual/s1/b.webm")).toBeNull();
  });
});
