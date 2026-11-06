import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { orderPulse } from "@/server/orderRoom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tiny endpoint the order room polls every few seconds; the page only reloads when this value changes. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [o] = await db.select({ clientId: orders.clientId, expertId: orders.expertId }).from(orders).where(eq(orders.id, id));
  const allowed = o && (o.clientId === session.user.id || o.expertId === session.user.id || session.user.roles.includes("ADMIN"));
  if (!allowed) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ v: await orderPulse(db, id) }, { headers: { "Cache-Control": "no-store" } });
}
