import { getDb } from "@/db";
import { verifyEmail } from "@/server/authTokens";

export const dynamic = "force-dynamic";

/** The link in the confirmation email. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const ok = await verifyEmail(getDb(), token);
  return new Response(null, { status: 303, headers: { Location: ok ? "/dashboard?verified=1" : "/dashboard?verified=0", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
