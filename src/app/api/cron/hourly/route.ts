import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { runHourly } from "@/server/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The hourly job (auto-approvals and reminders). Called by the GitHub Actions schedule in
 * .github/workflows/hourly.yml with header `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runHourly(getDb()));
}
