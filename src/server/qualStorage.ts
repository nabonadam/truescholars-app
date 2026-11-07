/**
 * Where Qualitative Studio keeps audio. Cloudflare R2 (S3-compatible) when R2_* is set, otherwise the
 * qual_audio table, which is fine for small pilots and for tests. Keys look like
 * qual/<studyId>/<responseId>/<questionId>-<n>.webm and never leave the server: the app streams audio
 * to researchers after checking they own the study.
 */

import { AwsClient } from "aws4fetch";
import { eq, like } from "drizzle-orm";
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
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Audio storage error (${res.status})`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "audio/webm" };
  }
  const [row] = await db.select().from(qualAudio).where(eq(qualAudio.key, key));
  return row ? { bytes: new Uint8Array(row.data), mimeType: row.mimeType } : null;
}

export async function deleteAudio(db: DB, key: string) {
  const s = r2();
  if (s) {
    await s.client.fetch(url(s, key), { method: "DELETE" });
    return;
  }
  await db.delete(qualAudio).where(eq(qualAudio.key, key));
}

/** Deletes every object under a prefix (a whole study or response). */
export async function deleteAudioPrefix(db: DB, prefix: string) {
  const s = r2();
  if (!s) {
    await db.delete(qualAudio).where(like(qualAudio.key, `${prefix.replace(/[%_]/g, "\\$&")}%`));
    return;
  }
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
