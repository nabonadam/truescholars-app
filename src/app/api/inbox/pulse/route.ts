import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { unreadNotificationCount } from "@/server/notifications";
import { inboxPulse, latestIncoming, unreadByOrder } from "@/server/orderRoom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Polled by the header badges and the Messages page; pages only reload when `v` changes. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const [v, byOrder, notifications, incoming] = await Promise.all([
    inboxPulse(db, session.user.id),
    unreadByOrder(db, session.user.id),
    unreadNotificationCount(db, session.user.id),
    latestIncoming(db, session.user.id),
  ]);
  const messages = [...byOrder.values()].reduce((a, b) => a + b, 0);
  return NextResponse.json({ v, messages, notifications, incoming }, { headers: { "Cache-Control": "no-store" } });
}
