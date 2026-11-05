import { auth } from "@/auth";
import { getDb } from "@/db";
import { getFileForUser } from "@/server/files";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  const file = await getFileForUser(getDb(), id, session.user);
  if (!file) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.sizeBytes),
      // Always download, never render inline: uploaded content is untrusted.
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
