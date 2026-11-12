"use client";

import { useState, useTransition } from "react";
import { createKeyAction, createWebhookAction, deleteWebhookAction, revokeKeyAction, testWebhookAction, toggleWebhookAction, type ApiState } from "@/app/actions/api";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "never");

function Notice({ s }: { s: ApiState | null }) {
  if (!s) return null;
  return (
    <div role="status" className={`rounded-sm p-3 text-sm ${s.error ? "bg-red-50 text-red-700" : "bg-green-tint text-green"}`}>
      {s.error ?? s.ok}
      {s.secret && <Secret value={s.secret} />}
    </div>
  );
}

function Secret({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 rounded-sm border border-line bg-white px-3 py-2 font-mono text-[13px] break-all text-ink">{value}</code>
      <button type="button" className="btn-outline px-3 py-1.5 text-sm" onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true), () => null)}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

type Key = { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };

export function ApiKeys({ keys, enabled }: { keys: Key[]; enabled: boolean }) {
  const [state, setState] = useState<ApiState | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [busy, start] = useTransition();
  const run = (f: () => Promise<ApiState>) => start(async () => setState(await f()));
  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);

  return (
    <section className="card flex flex-col gap-4" aria-labelledby="keys-h">
      <div>
        <h2 id="keys-h" className="text-xl font-bold">API keys</h2>
        <p className="text-sm text-ink-muted">Give each app its own key with only the scopes it needs. Keys are shown once, when created.</p>
      </div>
      <Notice s={state} />
      {enabled && (
        <form className="grid gap-3 rounded-sm border border-line p-4 sm:grid-cols-[1fr_auto]" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await createKeyAction(name, scopes); if (r.secret) setName(""); return r; }); }}>
          <label className="flex flex-col gap-1 text-sm font-bold">
            Key name
            <input className="field font-normal" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Field tablet app" maxLength={60} required />
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-bold">Scopes</legend>
            <div className="flex gap-3 pt-2">
              {["read", "write", "submit"].map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" className="size-4 accent-green" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} /> {s}
                </label>
              ))}
            </div>
          </fieldset>
          <button className="btn-primary sm:col-span-2 sm:justify-self-start" disabled={busy || !scopes.length}>{busy ? "Working…" : "Create key"}</button>
        </form>
      )}
      {active.length ? (
        <ul className="divide-y divide-line rounded-sm border border-line">
          {active.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{k.name}</p>
                <p className="text-[13px] text-ink-muted"><code>{k.prefix}…</code> · {k.scopes.join(", ")} · created {when(k.createdAt)} · last used {when(k.lastUsedAt)}</p>
              </div>
              <button type="button" className="text-sm font-bold text-red-700" disabled={busy} onClick={() => confirmRevoke(k.name) && run(() => revokeKeyAction(k.id))}>Revoke</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">No active keys.</p>
      )}
      {revoked.length > 0 && <p className="text-[13px] text-ink-muted">{revoked.length} revoked {revoked.length === 1 ? "key" : "keys"}.</p>}
    </section>
  );
}

// a plain in-page confirmation would be nicer; window.confirm keeps it simple and accessible
const confirmRevoke = (name: string) => window.confirm(`Revoke “${name}”? Apps using it will stop working.`);

type Hook = { id: string; url: string; events: string[]; study_id: string | null; active: boolean; failures: number; last_status: string | null; last_delivery_at: string | null };

export function Webhooks({ hooks, studies, events, enabled }: { hooks: Hook[]; studies: { id: string; title: string }[]; events: { id: string; help: string }[]; enabled: boolean }) {
  const [state, setState] = useState<ApiState | null>(null);
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<string[]>(events.map((e) => e.id));
  const [study, setStudy] = useState("");
  const [busy, start] = useTransition();
  const run = (f: () => Promise<ApiState>) => start(async () => setState(await f()));
  const title = (id: string | null) => (id ? (studies.find((s) => s.id === id)?.title ?? "a deleted study") : "All studies");

  return (
    <section className="card flex flex-col gap-4" aria-labelledby="hooks-h">
      <div>
        <h2 id="hooks-h" className="text-xl font-bold">Webhooks</h2>
        <p className="text-sm text-ink-muted">We POST to these addresses when responses arrive. Works with your own server, Zapier, Make and n8n. Deliveries are signed; see the documentation for checking them.</p>
      </div>
      <Notice s={state} />
      {enabled && (
        <form className="flex flex-col gap-3 rounded-sm border border-line p-4" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await createWebhookAction(url, picked, study); if (r.secret) setUrl(""); return r; }); }}>
          <label className="flex flex-col gap-1 text-sm font-bold">
            Endpoint URL
            <input className="field font-normal" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" required />
          </label>
          <fieldset>
            <legend className="text-sm font-bold">Events</legend>
            {events.map((ev) => (
              <label key={ev.id} className="mt-2 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-green" checked={picked.includes(ev.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, ev.id] : picked.filter((x) => x !== ev.id))} />
                <span><code>{ev.id}</code> <span className="text-ink-muted">{ev.help}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm font-bold">
            Study
            <select className="field font-normal" value={study} onChange={(e) => setStudy(e.target.value)}>
              <option value="">All studies</option>
              {studies.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <button className="btn-primary self-start" disabled={busy || !picked.length}>{busy ? "Checking…" : "Add webhook"}</button>
        </form>
      )}
      {hooks.length ? (
        <ul className="divide-y divide-line rounded-sm border border-line">
          {hooks.map((h) => (
            <li key={h.id} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${h.active ? "bg-green-tint text-green" : "bg-amber-tint text-amber-deep"}`}>{h.active ? "On" : "Off"}</span>
                <code className="min-w-0 flex-1 text-[13px] break-all">{h.url}</code>
              </div>
              <p className="text-[13px] text-ink-muted">
                {h.events.join(", ")} · {title(h.study_id)} · last delivery {when(h.last_delivery_at)}{h.last_status && ` (${h.last_status})`}{h.failures > 0 && ` · ${h.failures} failed in a row`}
              </p>
              <div className="flex flex-wrap gap-4 text-sm font-bold">
                <button type="button" className="text-green" disabled={busy || !enabled} onClick={() => run(() => testWebhookAction(h.id))}>Send test</button>
                <button type="button" className="text-green" disabled={busy || !enabled} onClick={() => run(() => toggleWebhookAction(h.id, !h.active))}>{h.active ? "Pause" : "Switch on"}</button>
                <button type="button" className="text-red-700" disabled={busy} onClick={() => window.confirm("Delete this webhook?") && run(() => deleteWebhookAction(h.id))}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">No webhooks yet.</p>
      )}
    </section>
  );
}
