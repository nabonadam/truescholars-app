"use client";

import { useEffect, useState } from "react";
import { Icon } from "../Icons";

export function ShareLink({ url: serverUrl, title, closed }: { url: string; title: string; closed: boolean }) {
  const [url, setUrl] = useState(serverUrl);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!serverUrl.startsWith("http")) setUrl(`${window.location.origin}${serverUrl}`);
  }, [serverUrl]);
  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text).catch(() => null);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };
  const message = `You're invited to take part in a research study: "${title}". It takes about 15–20 minutes and works on any phone. Open the link to read more and start: ${url}`;
  const embed = `<iframe src="${url}" width="100%" height="760" style="border:0;border-radius:12px" allow="microphone" title="${title.replace(/"/g, "&quot;")}"></iframe>`;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      {closed && <p className="rounded-sm bg-amber-tint px-4 py-3 text-sm text-amber-deep">This study is closed, so the link shows a “closed” message. Reopen it from the builder to accept responses again.</p>}
      <div className="card flex flex-col gap-3 p-6">
        <span className="eyebrow">Your study link</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input readOnly value={url} className="field font-mono text-sm" onFocus={(e) => e.currentTarget.select()} aria-label="Study link" />
          <button className="btn-amber shrink-0" onClick={() => copy(url, "link")}>{copied === "link" ? "Copied" : "Copy link"}</button>
        </div>
        <p className="text-sm text-ink-muted">Anyone with this link can respond. Respondents don’t need an account, and they never see your other studies or tools.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <a className="card flex flex-col gap-2 no-underline hover:border-green" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
          <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[#25d366] text-white"><Icon name="message" size={20} /></span>
          <b className="text-ink">Share on WhatsApp</b>
          <span className="text-sm text-ink-muted">Opens WhatsApp with an invitation ready to send to a person or group.</span>
        </a>
        <a className="card flex flex-col gap-2 no-underline hover:border-green" href={`mailto:?subject=${encodeURIComponent(`Invitation: ${title}`)}&body=${encodeURIComponent(message)}`}>
          <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-green-tint text-green"><Icon name="message" size={20} /></span>
          <b className="text-ink">Send by email</b>
          <span className="text-sm text-ink-muted">Opens your email app with the invitation filled in.</span>
        </a>
        <button className="card flex flex-col gap-2 text-left hover:border-green" onClick={() => copy(message, "msg")}>
          <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-amber-tint text-amber-deep"><Icon name="copy" size={20} /></span>
          <b className="text-ink">{copied === "msg" ? "Invitation copied" : "Copy the invitation"}</b>
          <span className="text-sm text-ink-muted">For SMS, Telegram, Facebook groups or anywhere else.</span>
        </button>
      </div>
      <details className="card">
        <summary className="cursor-pointer font-bold">Embed on a website</summary>
        <p className="mt-2 text-sm text-ink-muted">Paste this into a web page (for example a WordPress “Custom HTML” block).</p>
        <textarea readOnly className="field mt-2 min-h-24 font-mono text-xs" value={embed} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn-outline mt-2 min-h-10 px-4 text-sm" onClick={() => copy(embed, "embed")}>{copied === "embed" ? "Copied" : "Copy code"}</button>
      </details>
      <div className="card text-sm text-ink-muted">
        <b className="text-ink">Fieldwork tips.</b> Test the link on a phone yourself first, then mark your test response as a test on the Responses page. In noisy places, ask people to hold the phone close. If the network drops, respondents can reopen the link on the same phone and continue where they stopped.
      </div>
    </div>
  );
}
