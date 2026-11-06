import { getDb } from "@/db";
import { getAvatar } from "@/server/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Profile photos. Public (people see each other's photos); the ?v= in the URL changes with each new photo. */
export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const a = await getAvatar(getDb(), userId).catch(() => null);
  if (!a) return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
  const versioned = new URL(req.url).searchParams.has("v");
  return new Response(new Uint8Array(a.data), {
    headers: {
      "Content-Type": a.mimeType,
      "Content-Length": String(a.data.length),
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
