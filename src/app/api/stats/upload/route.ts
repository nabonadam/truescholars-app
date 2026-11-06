import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { StatsError, checkUpload, createSession, maxDatasetMb } from "@/server/stats";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The browser sends the raw file as the request body (so it can show upload progress).
 * It is gzip-compressed while it streams in, so only the compressed copy is ever held in memory.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in again to upload." }, { status: 401 });
  const name = decodeURIComponent(req.headers.get("x-file-name") ?? "").trim();
  const declared = Number(req.headers.get("content-length") ?? 0);
  try {
    checkUpload(name, declared || 1);
    if (!req.body) throw new StatsError("That file is empty.");
    const limit = maxDatasetMb() * 1024 * 1024;
    let size = 0;
    const gzip = createGzip({ level: 3 });
    const chunks: Buffer[] = [];
    gzip.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve, reject) => {
      gzip.on("end", resolve);
      gzip.on("error", reject);
    });
    for await (const chunk of Readable.fromWeb(req.body as import("node:stream/web").ReadableStream)) {
      size += chunk.length;
      if (size > limit) throw new StatsError(`Datasets can be up to ${maxDatasetMb()} MB.`);
      if (!gzip.write(chunk)) await new Promise((r) => gzip.once("drain", r));
    }
    gzip.end();
    await done;
    const id = await createSession(getDb(), session.user.id, { name, size, gz: Buffer.concat(chunks) });
    return Response.json({ id });
  } catch (err) {
    if (err instanceof StatsError) return Response.json({ error: err.message }, { status: 400 });
    console.error("stats upload", err);
    return Response.json({ error: "The upload did not finish. Check your connection and try again." }, { status: 500 });
  }
}
