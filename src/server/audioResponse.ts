/** Streams stored audio with Range support, so players can seek and Safari can play it. */
export function audioResponse(req: Request, file: { bytes: Uint8Array; mimeType: string }, cache = "private, max-age=3600") {
  const size = file.bytes.length;
  const base = { "Content-Type": file.mimeType, "Accept-Ranges": "bytes", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" };
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.min(start, size - 1);
    end = Math.min(end, size - 1);
    return new Response(file.bytes.slice(start, end + 1), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  return new Response(file.bytes as BodyInit, { headers: { ...base, "Content-Length": String(size) } });
}
