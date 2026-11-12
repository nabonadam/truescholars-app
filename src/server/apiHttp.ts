/** The plumbing every /api/v1 route shares: authentication, scopes, JSON in and out, and errors. */

import { NextResponse } from "next/server";
import { getDb, type DB } from "@/db";
import { ApiError, authenticate, requireScope, type ApiContext, type Scope } from "./apiAccess";
import { QualError } from "./qual";
import { readBody } from "./rateLimit";
import { QuotaError } from "./usage";

export const API_VERSION = "2026-11-01";

const headers = { "x-api-version": API_VERSION, "cache-control": "no-store" };

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) return json({ error: { code: err.code, message: err.message } }, err.status);
  if (err instanceof QualError) return json({ error: { code: "invalid_request", message: err.message } }, 400);
  if (err instanceof QuotaError) return json({ error: { code: "quota_exceeded", message: err.message } }, 429);
  console.error("api", err);
  return json({ error: { code: "server_error", message: "Something went wrong on our side. Please try again; if it keeps happening, contact support." } }, 500);
}

/** Reads a JSON body (up to `max` bytes). */
export async function body(req: Request, max = 1024 * 1024): Promise<Record<string, unknown>> {
  const raw = await readBody(req, max);
  if (!raw) throw new ApiError(413, "too_large", `The request body is larger than ${Math.round(max / 1024 / 1024)} MB.`);
  const text = new TextDecoder().decode(raw).trim();
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "The request body must be a JSON object.");
  }
}

type Handler<P> = (x: { db: DB; ctx: ApiContext; req: Request; params: P }) => Promise<Response | unknown>;

/** Wraps a route: checks the key and scope, runs it, and turns errors into JSON. */
export function route<P = Record<string, string>>(scope: Scope | null, fn: Handler<P>) {
  return async (req: Request, info: { params: Promise<P> }) => {
    try {
      const db = getDb();
      const ctx = await authenticate(db, req);
      if (scope) requireScope(ctx, scope);
      const out = await fn({ db, ctx, req, params: await info.params });
      return out instanceof Response ? out : json(out);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
