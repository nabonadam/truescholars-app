import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { PlanPicker } from "@/components/PlanPicker";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { isTestMode, paystackConfigured } from "@/lib/paystack";
import { PLANS, currencyForCountry, money } from "@/lib/plans";
import { apiAccessFor, RATE } from "@/server/apiAccess";
import { usdToGhs } from "@/server/fx";
import { API_PLAN_LIMIT } from "@/server/usage";

export const metadata: Metadata = { title: "Qualitative Studio API", description: "Create studies, collect and read responses, and pull the thematic analysis from your own systems. API keys and webhooks." };
export const dynamic = "force-dynamic";

const BASE = "https://app.thetruescholars.com/api/v1";

const ENDPOINTS: [string, string, string, string][] = [
  ["GET", "/me", "any", "The key, its scopes, your plan and this month's allowance"],
  ["GET", "/studies", "read", "All your studies, with response counts"],
  ["POST", "/studies", "write", "Create a study (title, intro, questions, settings)"],
  ["GET", "/studies/{id}", "read", "One study with its questions and settings"],
  ["PATCH", "/studies/{id}", "write", "Change the draft (send only what changes)"],
  ["DELETE", "/studies/{id}", "write", "Delete a study, its responses and recordings"],
  ["POST", "/studies/{id}/publish", "write", "Publish the draft and open the link"],
  ["POST", "/studies/{id}/open · /close", "write", "Start or stop accepting responses"],
  ["GET", "/studies/{id}/responses", "read", "Responses, oldest first; paged, filterable, or as CSV"],
  ["POST", "/studies/{id}/responses", "submit", "Submit a complete response collected elsewhere"],
  ["GET", "/responses/{id}", "read", "One response with every answer, transcript and translation"],
  ["GET", "/responses/{id}/audio/{question_id}", "read", "The recording of a voice answer"],
  ["GET", "/studies/{id}/analysis", "read", "Themes, codebook with quotes, participant matrix and report"],
  ["GET · POST", "/webhooks", "read · write", "List webhooks, or add one (the signing secret is shown once)"],
  ["PATCH · DELETE", "/webhooks/{id}", "write", "Pause, switch back on, or delete a webhook"],
  ["POST", "/webhooks/{id}/test", "write", "Send a signed sample delivery"],
];

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-sm border border-line">
      {label && <div className="border-b border-line bg-parchment px-3 py-1.5 text-[12px] font-bold text-ink-muted">{label}</div>}
      <pre className="overflow-x-auto bg-ink p-4 text-[13px] leading-relaxed text-white"><code>{children.trim()}</code></pre>
    </div>
  );
}

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="scroll-mt-6 text-2xl font-bold">{children}</h2>;
}

export default async function Developers() {
  const session = await auth();
  const user = session?.user ?? null;
  const db = getDb();
  const [me] = user ? await db.select({ country: users.country }).from(users).where(eq(users.id, user.id)) : [];
  const [fx, access] = await Promise.all([usdToGhs(db), user ? apiAccessFor(db, user) : null]);
  const p = PLANS.api;
  const minutes = API_PLAN_LIMIT.units["qual.minutes"]!;
  const nav = [["start", "Getting started"], ["auth", "Keys and scopes"], ["endpoints", "Endpoints"], ["studies", "Creating studies"], ["submit", "Submitting responses"], ["read", "Reading responses"], ["analysis", "Analysis"], ["webhooks", "Webhooks"], ["errors", "Errors and limits"]];

  return (
    <>
      <section className="bg-green text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_380px] lg:items-start">
          <div>
            <span className="text-xs font-bold tracking-wider text-amber uppercase">For developers and organisations</span>
            <h1 className="mt-2 text-4xl font-extrabold text-white">Qualitative Studio API</h1>
            <p className="mt-4 max-w-2xl text-lg text-on-green-muted">
              Run voice and text studies from your own systems. Create studies, send in responses you collect elsewhere, read transcripts and English translations, and pull the finished thematic analysis. Webhooks tell your app, or Zapier, Make and n8n, the moment a response arrives.
            </p>
            <ul className="mt-6 grid gap-2 text-[15px] sm:grid-cols-2">
              {["REST API with JSON in and out", "Keys with read, write and submit scopes", "Signed webhooks with automatic retries", `${minutes.toLocaleString("en-GB")} transcription minutes a month`, "Everything in the Qualitative Studio", "CSV export and audio downloads"].map((f) => (
                <li key={f} className="flex gap-2"><span className="text-amber">✓</span>{f}</li>
              ))}
            </ul>
          </div>
          <div className="card text-ink">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-bold">{p.name}</h2>
              <span className="text-right"><b className="text-2xl">{money(p.USD, "USD")}</b><span className="text-sm text-ink-muted">/month</span><span className="block text-[12.5px] text-ink-muted">or {money(p.GHS, "GHS")} in Africa</span></span>
            </div>
            <div className="mt-4">
              {access?.active ? (
                <div className="flex flex-col gap-3">
                  <p className="rounded-sm bg-green-tint p-3 text-sm text-green">{access.admin ? "Admins always have API access." : `Your API plan is active until ${access.until!.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.`}</p>
                  <Link href="/settings/api" className="btn-primary">Manage keys and webhooks</Link>
                  {!access.admin && paystackConfigured() && <details><summary className="cursor-pointer text-sm font-bold text-green">Extend your plan</summary><div className="mt-3"><PlanPicker tool="api" testMode={isTestMode()} initialCurrency={currencyForCountry(me?.country)} usdToGhs={fx.rate} /></div></details>}
                </div>
              ) : user ? (
                paystackConfigured() ? <PlanPicker tool="api" testMode={isTestMode()} initialCurrency={currencyForCountry(me?.country)} usdToGhs={fx.rate} /> : <p className="text-sm text-ink-muted">Online payment is being switched on. Message us and we&apos;ll set up your API plan.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <Link href="/sign-up?next=/developers" className="btn-amber">Create an account</Link>
                  <Link href="/sign-in?next=/developers" className="btn-outline">Sign in to subscribe</Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[200px_1fr]">
        <nav aria-label="On this page" className="hidden lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-1 lg:self-start">
          {nav.map(([id, label]) => <a key={id} href={`#${id}`} className="rounded-sm px-3 py-1.5 text-sm font-bold text-ink no-underline hover:bg-white">{label}</a>)}
        </nav>

        <article className="flex min-w-0 flex-col gap-6 text-[15.5px] leading-relaxed">
          <H id="start">Getting started</H>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Subscribe to the API plan above.</li>
            <li>Create a key in <Link href="/settings/api">Settings → Developer API</Link>. Copy it straight away: it is shown once.</li>
            <li>Call the API from your server with the key in the <code>Authorization</code> header.</li>
          </ol>
          <Code label="Your first call">{`curl ${BASE}/studies \\
  -H "Authorization: Bearer ts_live_..."`}</Code>
          <p>The base URL is <code>{BASE}</code>. Requests and responses are JSON; times are ISO 8601 in UTC.</p>

          <H id="auth">Keys and scopes</H>
          <p>Send the key as <code>Authorization: Bearer ts_live_...</code> (or in an <code>x-api-key</code> header). Keep keys on your server: never put them in a web page or mobile app. Each key has one or more scopes:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>read</b>: studies, responses, recordings, analysis and webhooks.</li>
            <li><b>write</b>: create, change, publish, close and delete studies; manage webhooks.</li>
            <li><b>submit</b>: send in responses. Give a data-collection app only this scope.</li>
          </ul>
          <p>If a key leaks, revoke it in settings and create a new one. Keys stop working when the API plan ends; your studies and data stay.</p>

          <H id="endpoints">Endpoints</H>
          <div className="overflow-x-auto rounded-sm border border-line bg-white">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-parchment"><tr><th className="p-2.5">Method</th><th className="p-2.5">Path</th><th className="p-2.5">Scope</th><th className="p-2.5">What it does</th></tr></thead>
              <tbody>
                {ENDPOINTS.map(([m, path, scope, what]) => (
                  <tr key={m + path} className="border-t border-line align-top"><td className="p-2.5 font-mono text-[12.5px] font-bold whitespace-nowrap text-green">{m}</td><td className="p-2.5 font-mono text-[12.5px]">{path}</td><td className="p-2.5 text-[13px] whitespace-nowrap">{scope}</td><td className="p-2.5">{what}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <H id="studies">Creating studies</H>
          <p>Question types are <code>voice</code>, <code>text</code>, <code>choice</code>, <code>multi</code>, <code>dropdown</code>, <code>rating</code> and <code>section</code> (a heading). Give each question an <code>id</code> you can refer to later; if you leave it out, one is made for you. Studies start as drafts: publish to open the link.</p>
          <Code label="Create and publish a study">{`curl ${BASE}/studies \\
  -H "Authorization: Bearer ts_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Farmers and changing rainfall",
    "questions": [
      { "id": "story", "type": "voice", "text": "Tell us how the rains have changed." },
      { "id": "region", "type": "choice", "text": "Region", "options": ["North", "South"] },
      { "id": "worry", "type": "rating", "text": "How worried are you?", "scale_max": 5 }
    ],
    "settings": { "language": "en", "ask_name": "optional", "translate": false }
  }'

curl -X POST ${BASE}/studies/{id}/publish -H "Authorization: Bearer ts_live_..."`}</Code>
          <p>Settings: <code>language</code> (en, multi, fr, pt, es, de, zh-CN, zh-TW, zh-HK, none), <code>max_seconds</code> per recording, <code>ask_name</code> and <code>ask_email</code> (required, optional, no), <code>thank_you</code>, <code>notify_owner</code>, and <code>translate</code> (English translations of open answers). The response includes <code>public_url</code>, the link to share with participants.</p>

          <H id="submit">Submitting responses</H>
          <p>Collected answers somewhere else, such as a tablet app or a field form? Send each finished response in one request. Answers are keyed by question id; recordings go in as base64 (up to 25 MB each, webm, ogg, m4a, mp3 or wav). Required questions must be answered. Set <code>&quot;test&quot;: true</code> to keep a response out of exports and analysis.</p>
          <Code label="Submit a response">{`curl ${BASE}/studies/{id}/responses \\
  -H "Authorization: Bearer ts_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Participant 14",
    "answers": {
      "story":  { "audio": { "data": "<base64>", "mime_type": "audio/m4a", "seconds": 94 } },
      "region": { "choice": "North" },
      "worry":  { "rating": 4 }
    }
  }'`}</Code>
          <p>Recordings are transcribed (and translated, if the study asks) in the background. Listen for the <code>response.processed</code> webhook, or read the response again later.</p>

          <H id="read">Reading responses</H>
          <p><code>GET /studies/{"{id}"}/responses</code> returns submitted responses, oldest first, 50 at a time (up to 200 with <code>limit</code>). Filters: <code>status</code> (submitted, in_progress, all), <code>since</code> (an ISO time), <code>include_test=true</code>. When <code>has_more</code> is true, pass <code>after=&lt;next_after&gt;</code> for the next page. Add <code>format=csv</code> for a spreadsheet with one column per question.</p>
          <Code label="A response">{`{
  "id": "6f1c…",
  "study_id": "a92e…",
  "participant": "P07",
  "status": "submitted",
  "test": false,
  "name": "Participant 14",
  "submitted_at": "2026-11-12T09:41:03.000Z",
  "answers": [
    {
      "question_id": "story", "number": 1, "type": "voice",
      "question": "Tell us how the rains have changed.",
      "text": null,
      "audio": { "seconds": 94, "mime_type": "audio/m4a", "url": "${BASE}/responses/6f1c…/audio/story" },
      "transcript": "The rains come later every year…",
      "transcription_status": "done",
      "translation": null
    },
    { "question_id": "region", "number": 2, "type": "choice", "question": "Region", "choice": "North" }
  ]
}`}</Code>

          <H id="analysis">Analysis</H>
          <p>Run the thematic analysis in the Qualitative Studio, then read it with <code>GET /studies/{"{id}"}/analysis</code>: <code>themes</code> (with their codes and subthemes), the <code>codebook</code> (definitions, participants and verbatim quotes), the participant-by-theme <code>matrix</code>, and the written <code>report</code> in Markdown. <code>phases_completed</code> says which steps have been run.</p>

          <H id="webhooks">Webhooks</H>
          <p>Add a webhook in settings or with <code>POST /webhooks</code>. It must be a public <code>https://</code> address. Events:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><code>response.submitted</code>: a participant has submitted (recordings not yet transcribed).</li>
            <li><code>response.processed</code>: transcripts and translations are done, so the response is ready to read.</li>
          </ul>
          <p>Each delivery is a POST with the response in <code>data.response</code>. Answer with any 2xx status within 10 seconds. Failed deliveries are retried about every hour, then less often, for a day. After 20 failures in a row the webhook is switched off and you are told.</p>
          <Code label="Delivery body">{`{
  "id": "delivery id",
  "type": "response.processed",
  "created_at": "2026-11-12T09:42:10.000Z",
  "data": { "study": { "id": "a92e…", "title": "Farmers and changing rainfall" }, "response": { … } }
}`}</Code>
          <p>Check that each delivery is really from us. The <code>x-ts-signature</code> header holds a time and an HMAC-SHA256 of <code>&lt;time&gt;.&lt;raw body&gt;</code> made with your webhook&apos;s secret (<code>whsec_...</code>):</p>
          <Code label="Node.js">{`import crypto from "node:crypto";

function verify(secret, header, rawBody) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // older than 5 minutes
  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}`}</Code>
          <Code label="Python">{`import hashlib, hmac, time

def verify(secret: str, header: str, raw_body: bytes) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    if abs(time.time() - int(parts["t"])) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])`}</Code>
          <p><b>No-code tools.</b> In Zapier use “Webhooks by Zapier → Catch Hook”, in Make “Custom webhook”, in n8n a “Webhook” node. Paste the address they give you into Settings → Developer API, choose the events, and press <i>Send test</i>.</p>

          <H id="errors">Errors and limits</H>
          <p>Errors come back as <code>{`{ "error": { "code": "...", "message": "..." } }`}</code> with a matching status: 400 invalid_request, 401 unauthorized, 402 plan_required, 403 insufficient_scope, 404 not_found, 409 study_not_live, 413 too_large, 429 rate_limited or quota_exceeded, 500 server_error.</p>
          <p>Each key can make {RATE.perMinute} requests a minute and {RATE.perDay.toLocaleString("en-GB")} a day. The plan includes {minutes.toLocaleString("en-GB")} minutes of automatic transcription a month, plus AI translation and analysis within fair use; see your usage with <code>GET /me</code>. Recordings over the allowance wait until it resets, or can be transcribed later from the studio.</p>
          <p className="text-ink-muted">Questions or a larger plan for your organisation? <Link href="/messages">Message us</Link>.</p>
        </article>
      </div>
    </>
  );
}
