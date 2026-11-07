import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { autoApproveDue } from "@/server/orderRoom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Approves deliveries the client hasn't responded to within the auto-approve window.
 * Call hourly from a scheduler with header `Authorization: Bearer <CRON_SECRET>`.
 * (Order pages also run this check when opened, so nothing waits forever without a scheduler.)
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameSecret(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await autoApproveDue(getDb()));
}


function sameSecret(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
