import { NextResponse } from "next/server";
import { count } from "drizzle-orm";
import { getDb } from "@/db";
import { qualAudio } from "@/db/schema";
import { requireUser } from "@/server/guards";
import { checkStorage, moveToR2 } from "@/server/qualStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Admin: is file storage working? ?move=1 also moves a batch of older files into R2 now. */
export async function GET(req: Request) {
  await requireUser("ADMIN");
  const db = getDb();
  const check = await checkStorage();
  const moved = check.ok && check.storage === "r2" && new URL(req.url).searchParams.get("move") ? await moveToR2(db, 40) : null;
  const [{ n }] = await db.select({ n: count() }).from(qualAudio);
  return NextResponse.json({ ...check, inDatabase: Number(n), moved });
}
