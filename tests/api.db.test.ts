import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";

let db: DB;
const pending: Promise<unknown>[] = [];
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => db }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => Promise<unknown>) => void pending.push(fn()) }));

const { authenticate, createApiKey, grantApiAccess, revokeApiKey, ApiError } = await import("@/server/apiAccess");
const { afterSubmit } = await import("@/server/qualApi");
const { checkUrl, createWebhook, emit, retryWebhooks, verifySignature, privateAddress } = await import("@/server/webhooks");
const studies = await import("@/app/api/v1/studies/route");
const study = await import("@/app/api/v1/studies/[id]/route");
const publish = await import("@/app/api/v1/studies/[id]/publish/route");
const responses = await import("@/app/api/v1/studies/[id]/responses/route");
const oneResponse = await import("@/app/api/v1/responses/[rid]/route");
const audio = await import("@/app/api/v1/responses/[rid]/audio/[qid]/route");
const analysis = await import("@/app/api/v1/studies/[id]/analysis/route");
const me = await import("@/app/api/v1/me/route");

let user: { id: string; roles: string[] };

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [u] = await d.insert(schema.users).values({ email: "kofi@example.com", name: "Kofi Mensah" }).returning();
  user = { id: u.id, roles: ["CLIENT"] };
  pending.length = 0;
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

const req = (path: string, key: string, init: { method?: string; body?: unknown } = {}) =>
  new Request(`https://app.test/api/v1${path}`, { method: init.method ?? "GET", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
const p = <T,>(v: T) => ({ params: Promise.resolve(v) });

async function keyWith(scopes = ["read", "write", "submit"]) {
  await grantApiAccess(db, user.id, 30, "test", new Date(), { quiet: true });
  return (await createApiKey(db, user, { name: "My app", scopes })).key;
}

describe("API keys", () => {
  it("need the API plan, are stored only as a hash, and stop working when revoked or the plan ends", async () => {
    await expect(createApiKey(db, user, { name: "x", scopes: ["read"] })).rejects.toThrow(/API plan/);
    const key = await keyWith(["read"]);
    expect(key).toMatch(/^ts_live_[A-Za-z0-9]{32}$/);
    const [row] = await db.select().from(schema.apiKeys);
    expect(row.keyHash).not.toContain(key.slice(8));
    expect(row.prefix).toBe(key.slice(0, 14));

    const ctx = await authenticate(db, req("/me", key));
    expect(ctx.user.id).toBe(user.id);
    await expect(authenticate(db, req("/me", "ts_live_" + "a".repeat(32)))).rejects.toMatchObject({ status: 401 });
    await expect(authenticate(db, new Request("https://app.test/api/v1/me"))).rejects.toMatchObject({ status: 401 });
    // x-api-key works too
    expect((await authenticate(db, new Request("https://app.test/api/v1/me", { headers: { "x-api-key": key } }))).key.id).toBe(row.id);

    // plan ended
    await expect(authenticate(db, req("/me", key), new Date(Date.now() + 40 * 86_400_000))).rejects.toMatchObject({ status: 402 });

    await revokeApiKey(db, user.id, row.id);
    await expect(authenticate(db, req("/me", key))).rejects.toMatchObject({ status: 401 });
  });

  it("enforce scopes and rate limits", async () => {
    const key = await keyWith(["read"]);
    const res = await studies.POST(req("/studies", key, { method: "POST", body: { title: "No" } }), p({}));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("insufficient_scope");
    const ok = await me.GET(req("/me", key), p({}));
    expect(ok.status).toBe(200);
    expect((await ok.json()).usage.units[0]).toMatchObject({ kind: "qual.minutes", limit: 3000 });
    const now = new Date();
    for (let i = 0; i < 118; i++) await authenticate(db, req("/me", key), now);
    await expect(authenticate(db, req("/me", key), now)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("studies and responses over the API", () => {
  it("creates, publishes, takes a submitted response, and reads it back as JSON and CSV", async () => {
    const key = await keyWith();
    const created = await studies.POST(
      req("/studies", key, {
        method: "POST",
        body: {
          title: "Market traders",
          questions: [
            { id: "story", type: "voice", text: "Tell us about a hard month." },
            { id: "region", type: "choice", text: "Region", options: ["North", "South"] },
            { id: "score", type: "rating", text: "How hard?", scale_max: 5 },
            { id: "more", type: "text", text: "Anything else?", required: false },
          ],
          settings: { language: "en", ask_name: "no" },
        },
      }),
      p({}),
    );
    expect(created.status).toBe(201);
    const s = await created.json();
    expect(s.status).toBe("draft");
    expect(s.questions.map((q: { id: string }) => q.id)).toEqual(["story", "region", "score", "more"]);
    expect(s.settings.ask_name).toBe("no");
    expect(s.public_url).toMatch(/\/s\/[a-z0-9]+$/);

    // a draft can't take responses
    const early = await responses.POST(req(`/studies/${s.id}/responses`, key, { method: "POST", body: { answers: {} } }), p({ id: s.id }));
    expect(early.status).toBe(409);

    const patched = await study.PATCH(req(`/studies/${s.id}`, key, { method: "PATCH", body: { title: "Market traders, Accra" } }), p({ id: s.id }));
    expect((await patched.json()).questions).toHaveLength(4); // questions kept
    expect((await (await publish.POST(req(`/studies/${s.id}/publish`, key, { method: "POST" }), p({ id: s.id }))).json()).status).toBe("live");

    // missing a required answer: refused, and nothing is left behind
    const bad = await responses.POST(req(`/studies/${s.id}/responses`, key, { method: "POST", body: { answers: { region: { choice: "North" } } } }), p({ id: s.id }));
    expect(bad.status).toBe(400);
    expect(await db.select().from(schema.qualResponses)).toHaveLength(0);
    const wrongId = await responses.POST(req(`/studies/${s.id}/responses`, key, { method: "POST", body: { answers: { nope: { text: "x" } } } }), p({ id: s.id }));
    expect((await wrongId.json()).error.message).toMatch(/isn't a question/);

    const sent = await responses.POST(
      req(`/studies/${s.id}/responses`, key, {
        method: "POST",
        body: { answers: { story: { audio: { data: Buffer.from(new Uint8Array(2000).fill(7)).toString("base64"), mime_type: "audio/webm", seconds: 9 } }, region: { choice: "South" }, score: { rating: 4 }, more: { text: "Prices doubled." } } },
      }),
      p({ id: s.id }),
    );
    expect(sent.status).toBe(201);
    const r = await sent.json();
    expect(r).toMatchObject({ participant: "P01", status: "submitted", test: false });
    const byId = Object.fromEntries(r.answers.map((a: { question_id: string }) => [a.question_id, a]));
    expect(byId.region.choice).toBe("South");
    expect(byId.score.rating).toBe(4);
    expect(byId.more.text).toBe("Prices doubled.");
    expect(byId.story.audio).toMatchObject({ seconds: 9, mime_type: "audio/webm" });
    expect(byId.story.transcription_status).toBe("pending");
    await Promise.all(pending);

    // a test response is hidden unless asked for
    await responses.POST(req(`/studies/${s.id}/responses`, key, { method: "POST", body: { test: true, answers: { story: { text: "typed" }, region: { choice: "North" }, score: { rating: 1 } } } }), p({ id: s.id }));
    const list = await (await responses.GET(req(`/studies/${s.id}/responses`, key), p({ id: s.id }))).json();
    expect(list.data).toHaveLength(1);
    const withTest = await (await responses.GET(req(`/studies/${s.id}/responses?include_test=true&limit=1`, key), p({ id: s.id }))).json();
    expect(withTest).toMatchObject({ has_more: true, next_after: r.id });
    const page2 = await (await responses.GET(req(`/studies/${s.id}/responses?include_test=true&after=${r.id}`, key), p({ id: s.id }))).json();
    expect(page2.data[0].test).toBe(true);

    const csv = await responses.GET(req(`/studies/${s.id}/responses?format=csv`, key), p({ id: s.id }));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("Prices doubled.");

    expect((await (await oneResponse.GET(req(`/responses/${r.id}`, key), p({ rid: r.id }))).json()).id).toBe(r.id);
    const clip = await audio.GET(req(`/responses/${r.id}/audio/story`, key), p({ rid: r.id, qid: "story" }));
    expect(clip.status).toBe(200);
    expect((await clip.arrayBuffer()).byteLength).toBe(2000);

    const a = await (await analysis.GET(req(`/studies/${s.id}/analysis`, key), p({ id: s.id }))).json();
    expect(a).toMatchObject({ study_id: s.id, themes: [], codebook: [], report: null });
  });

  it("never shows another account's studies", async () => {
    const key = await keyWith();
    const [other] = await db.insert(schema.users).values({ email: "esi@example.com" }).returning();
    const { createStudy } = await import("@/server/qual");
    const theirs = await createStudy(db, other.id, { title: "Private" });
    expect((await study.GET(req(`/studies/${theirs}`, key), p({ id: theirs }))).status).toBe(404);
    expect((await responses.GET(req(`/studies/${theirs}/responses`, key), p({ id: theirs }))).status).toBe(404);
    expect((await (await studies.GET(req("/studies", key), p({}))).json()).data).toHaveLength(0);
  });
});

describe("webhooks", () => {
  it("accept only public HTTPS addresses", async () => {
    await expect(checkUrl("http://example.com/hook", false)).rejects.toThrow(/https/);
    await expect(checkUrl("https://127.0.0.1/hook", false)).rejects.toThrow(/public/);
    await expect(checkUrl("https://localhost/hook", false)).rejects.toThrow(/public/);
    await expect(checkUrl("https://[::1]/hook", false)).rejects.toThrow(/public/);
    await expect(checkUrl("https://example.com:8443/hook", false)).rejects.toThrow(/port/);
    expect(await checkUrl("https://hooks.zapier.com/hooks/catch/1/abc", false)).toBe("https://hooks.zapier.com/hooks/catch/1/abc");
    expect(privateAddress("10.2.3.4")).toBe(true);
    expect(privateAddress("169.254.169.254")).toBe(true);
    expect(privateAddress("::ffff:192.168.1.1")).toBe(true);
    expect(privateAddress("8.8.8.8")).toBe(false);
  });

  it("are signed, retried when they fail, and switched off after too many failures", async () => {
    await grantApiAccess(db, user.id, 30, "test", new Date(), { quiet: true });
    const { createStudy } = await import("@/server/qual");
    const sid = await createStudy(db, user.id, { title: "S" });
    const { secret } = await createWebhook(db, user.id, { url: "https://example.com/hook" }, { resolve: false });
    const got: { body: string; headers: Record<string, string> }[] = [];
    const ok = async (_u: string, body: string, headers: Record<string, string>) => (got.push({ body, headers }), { status: 200 });
    expect(await emit(db, user.id, "response.submitted", sid, { hello: 1 }, ok)).toEqual(["delivered"]);
    expect(verifySignature(secret, got[0].headers["x-ts-signature"], got[0].body)).toBe(true);
    expect(verifySignature(secret, got[0].headers["x-ts-signature"], got[0].body + " ")).toBe(false);
    expect(JSON.parse(got[0].body)).toMatchObject({ type: "response.submitted", data: { hello: 1 } });

    // a failure is retried by the hourly job
    const down = async () => ({ status: 503 });
    expect(await emit(db, user.id, "response.processed", sid, { n: 2 }, down)).toEqual(["failed"]);
    expect((await retryWebhooks(db, new Date(), ok)).tried).toBe(0); // not due yet
    expect(await retryWebhooks(db, new Date(Date.now() + 61 * 60_000), ok)).toEqual({ tried: 1, delivered: 1 });

    // 20 failures in a row: switched off, and the owner told
    for (let i = 0; i < 20; i++) await emit(db, user.id, "response.submitted", sid, {}, down);
    const [w] = await db.select().from(schema.webhooks);
    expect(w.active).toBe(false);
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    expect(notes.some((n) => n.title.includes("webhook"))).toBe(true);
  });

  it("fire when a response is submitted and again when it has been processed", async () => {
    const key = await keyWith();
    const s = await (await studies.POST(req("/studies", key, { method: "POST", body: { title: "T", questions: [{ id: "q1", type: "text", text: "Why?" }] } }), p({}))).json();
    await publish.POST(req(`/studies/${s.id}/publish`, key, { method: "POST" }), p({ id: s.id }));
    await createWebhook(db, user.id, { url: "https://example.com/hook", events: ["response.processed"], studyId: s.id }, { resolve: false });
    await createWebhook(db, user.id, { url: "https://example.com/all" }, { resolve: false });
    const { apiSubmit } = await import("@/server/qualApi");
    const done = await apiSubmit(db, user.id, s.id, { answers: { q1: { text: "Because." } } });
    const calls: { url: string; type: string; data: { response: { answers: { text: string }[] } } }[] = [];
    await afterSubmit(db, done, async (url, body) => (calls.push({ url, ...JSON.parse(body) }), { status: 204 }));
    expect(calls.map((c) => `${c.url} ${c.type}`).sort()).toEqual(["https://example.com/all response.processed", "https://example.com/all response.submitted", "https://example.com/hook response.processed"]);
    expect(calls[0].data.response.answers[0].text).toBe("Because.");
  });
});
