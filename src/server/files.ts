/** Order file uploads: validated, stored, and only downloadable by the order's client, expert or an admin. */

import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { files, orders } from "@/db/schema";

export class FileError extends Error {}

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_FILES_PER_UPLOAD = 5;

const ALLOWED_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "odt", "rtf", "txt", "md",
  "xls", "xlsx", "csv", "ods",
  "ppt", "pptx",
  "png", "jpg", "jpeg", "webp",
  "zip",
  "dta", "do", "log", "smcl", "sav", "sps", "r", "rmd", "py", "ipynb", "nvp", "nvpx",
  "mp3", "m4a", "wav",
]);

export function checkUpload(name: string, size: number) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new FileError(`"${name}": this file type isn't supported.`);
  if (size <= 0) throw new FileError(`"${name}" is empty.`);
  if (size > MAX_FILE_BYTES) throw new FileError(`"${name}" is larger than 10 MB.`);
}

/** Saves uploaded browser File objects for an order; returns their ids. */
export async function saveUploads(db: DB, p: { orderId: string; ownerId: string; uploads: File[] }): Promise<string[]> {
  const real = p.uploads.filter((f) => f && f.size > 0);
  if (real.length > MAX_FILES_PER_UPLOAD) throw new FileError(`Attach up to ${MAX_FILES_PER_UPLOAD} files at a time.`);
  real.forEach((f) => checkUpload(f.name, f.size));
  if (real.length === 0) return [];
  const rows = await Promise.all(
    real.map(async (f) => ({
      orderId: p.orderId,
      ownerId: p.ownerId,
      name: f.name.slice(0, 200),
      mimeType: f.type || "application/octet-stream",
      sizeBytes: f.size,
      data: Buffer.from(await f.arrayBuffer()),
    })),
  );
  const saved = await db.insert(files).values(rows).returning({ id: files.id });
  return saved.map((r) => r.id);
}

/** File metadata (no bytes) for display. */
export async function fileMeta(db: DB, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ id: files.id, name: files.name, sizeBytes: files.sizeBytes })
    .from(files)
    .where(inArray(files.id, ids));
}

export async function getFileForUser(db: DB, fileId: string, user: { id: string; roles: string[] }) {
  const [f] = await db.select().from(files).where(eq(files.id, fileId));
  if (!f) return null;
  if (user.roles.includes("ADMIN") || f.ownerId === user.id) return f;
  if (!f.orderId) return null;
  const [o] = await db.select({ clientId: orders.clientId, expertId: orders.expertId }).from(orders).where(eq(orders.id, f.orderId));
  return o && (o.clientId === user.id || o.expertId === user.id) ? f : null;
}

export function formatBytes(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
