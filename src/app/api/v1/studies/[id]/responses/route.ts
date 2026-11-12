import { after } from "next/server";
import { getDb } from "@/db";
import { route, body, json } from "@/server/apiHttp";
import { responsesCsv } from "@/server/qualExport";
import { afterSubmit, apiResponse, apiResponses, apiSubmit } from "@/server/qualApi";
import { listResponses } from "@/server/qual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { id: string };

/** Responses, oldest first. ?status=submitted|in_progress|all &since=<ISO time> &limit=1..200 &after=<response id> &include_test=true &format=csv */
export const GET = route<P>("read", async ({ db, ctx, req, params }) => {
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const page = await apiResponses(db, ctx.user.id, params.id, q);
  if (q.format === "csv") {
    const all = await listResponses(db, ctx.user.id, params.id);
    const ids = new Set(page.rows.map((r) => r.id));
    return new Response(responsesCsv(page.study, all.filter((r) => ids.has(r.id)), { all: true }), { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
  }
  return { data: page.data, has_more: page.has_more, next_after: page.next_after };
});

/** Submits a complete response collected elsewhere. Recordings go in as base64 (up to 25 MB each). */
export const POST = route<P>("submit", async ({ db, ctx, req, params }) => {
  const done = await apiSubmit(db, ctx.user.id, params.id, await body(req, 60 * 1024 * 1024));
  after(() => afterSubmit(getDb(), done).catch((e) => console.error("after submit", e)));
  return json(await apiResponse(db, ctx.user.id, done.responseId), 201);
});
