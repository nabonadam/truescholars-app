/**
 * Where Qualitative Studio keeps audio. Cloudflare R2 (S3-compatible) when R2_* is set, otherwise the
 * qual_audio table, which is fine for small pilots and for tests. Keys look like
 * qual/<studyId>/<responseId>/<questionId>-<n>.webm and never leave the server: the app streams audio
 * to researchers after checking they own the study. Literature Review PDFs use the same store (lit/…).
 *
 * Switching R2 on later is safe: files saved in the database before then are still found there, and
 * are moved to R2 when read and by the hourly job (moveToR2).
 */

import { AwsClient } from "aws4fetch";
import { count, eq, like } from "drizzle-orm";
import type { DB } from "@/db";
import { qualAudio } from "@/db/schema";

type R2 = { client: AwsClient; base: string };

function r2(): R2 | null {
  const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: key, R2_SECRET_ACCESS_KEY: secret, R2_BUCKET: bucket } = process.env;
  if (!account || !key || !secret || !bucket) return null;
  return {
    client: new AwsClient({ accessKeyId: key, secretAccessKey: secret, service: "s3", region: "auto" }),
    base: `${process.env.R2_ENDPOINT?.replace(/\/$/, "") || `https://${account}.r2.cloudflarestorage.com`}/${bucket}`,
  };
}

export const storageKind = () => (r2() ? "r2" : "database");
const url = (s: R2, key: string) => `${s.base}/${key.split("/").map(encodeURIComponent).join("/")}`;

export async function putAudio(db: DB, key: string, bytes: Uint8Array, mimeType: string) {
  const s = r2();
  if (s) {
    const res = await s.client.fetch(url(s, key), { method: "PUT", body: bytes as BodyInit, headers: { "content-type": mimeType } });
    if (!res.ok) throw new Error(`Audio storage refused the upload (${res.status})`);
    return;
  }
  const data = Buffer.from(bytes);
  await db.insert(qualAudio).values({ key, mimeType, data }).onConflictDoUpdate({ target: qualAudio.key, set: { mimeType, data } });
}

export async function getAudio(db: DB, key: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const s = r2();
  if (s) {
    const res = await s.client.fetch(url(s, key));
    if (res.ok) return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "audio/webm" };
    if (res.status !== 404) throw new Error(`Audio storage error (${res.status})`);
    // saved before R2 was switched on: serve it from the database, and move it across
    const [row] = await db.select().from(qualAudio).where(eq(qualAudio.key, key));
    if (!row) return null;
    const file = { bytes: new Uint8Array(row.data), mimeType: row.mimeType };
    await moveOne(db, s, row).catch((err) => console.error("move to R2 failed", key, err));
    return file;
  }
  const [row] = await db.select().from(qualAudio).where(eq(qualAudio.key, key));
  return row ? { bytes: new Uint8Array(row.data), mimeType: row.mimeType } : null;
}

async function moveOne(db: DB, s: R2, row: { key: string; mimeType: string; data: Buffer }) {
  const res = await s.client.fetch(url(s, row.key), { method: "PUT", body: new Uint8Array(row.data) as BodyInit, headers: { "content-type": row.mimeType } });
  if (!res.ok) throw new Error(`R2 refused ${row.key} (${res.status})`);
  await db.delete(qualAudio).where(eq(qualAudio.key, row.key));
}

/** Moves files saved in the database (before R2 was switched on) into R2, a batch at a time. */
export async function moveToR2(db: DB, batch = 20) {
  const s = r2();
  if (!s) return { moved: 0, left: 0, storage: "database" };
  const rows = await db.select().from(qualAudio).limit(batch);
  let moved = 0;
  for (const row of rows) {
    try {
      await moveOne(db, s, row);
      moved++;
    } catch (err) {
      console.error("move to R2 failed", row.key, err);
    }
  }
  const [{ n }] = await db.select({ n: count() }).from(qualAudio);
  return { moved, left: Number(n), storage: "r2" };
}

/** Writes, reads back and deletes a small test file: proves the R2 settings work. */
export async function checkStorage() {
  const s = r2();
  if (!s) return { storage: "database", ok: true, note: "R2 isn't configured; files are kept in the database." };
  const key = `_health/${Date.now()}.txt`;
  try {
    const put = await s.client.fetch(url(s, key), { method: "PUT", body: "ok", headers: { "content-type": "text/plain" } });
    if (!put.ok) return { storage: "r2", ok: false, step: "write", status: put.status, detail: (await put.text()).slice(0, 300) };
    const get = await s.client.fetch(url(s, key));
    const body = await get.text();
    if (!get.ok || body !== "ok") return { storage: "r2", ok: false, step: "read", status: get.status };
    const del = await s.client.fetch(url(s, key), { method: "DELETE" });
    return { storage: "r2", ok: del.ok || del.status === 204, step: "done" };
  } catch (err) {
    return { storage: "r2", ok: false, step: "connect", detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteAudio(db: DB, key: string) {
  const s = r2();
  if (s) await s.client.fetch(url(s, key), { method: "DELETE" });
  await db.delete(qualAudio).where(eq(qualAudio.key, key)); // also any copy from before R2
}

/** Deletes every object under a prefix (a whole study or response). */
export async function deleteAudioPrefix(db: DB, prefix: string) {
  const s = r2();
  await db.delete(qualAudio).where(like(qualAudio.key, `${prefix.replace(/[%_]/g, "\\$&")}%`));
  if (!s) return;
  for (let page = 0; page < 200; page++) {
    const res = await s.client.fetch(`${s.base}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`);
    if (!res.ok) return;
    const xml = await res.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    if (!keys.length) return;
    await Promise.all(keys.map((k) => s.client.fetch(url(s, k), { method: "DELETE" })));
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) return;
  }
}
