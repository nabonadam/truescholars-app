import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { notifications } from "@/db/schema";

/** Opening a notification: mark it read, then go where it points. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return go("/sign-in");
  const { id } = await params;
  const [n] = await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ link: notifications.link });
  const to = n?.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : "/notifications";
  return go(to);
}

// a relative Location: behind Render's proxy req.url carries the internal host
const go = (to: string) => new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
