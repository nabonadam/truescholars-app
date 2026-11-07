"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { avatarAction, expertProfileAction, passwordAction, profileAction, removeAvatarAction, type AccountState } from "@/app/actions/account";
import { Avatar } from "./UserAvatar";

function Note({ state, ok }: { state: AccountState; ok: string }) {
  if (state?.error)
    return (
      <p role="alert" className="rounded-sm bg-amber-tint px-4 py-3 text-sm font-medium text-amber-deep">
        {state.error}
      </p>
    );
  if (state?.ok)
    return (
      <p role="status" className="inline-flex items-center gap-2 rounded-sm bg-green-tint px-4 py-3 text-sm font-medium text-green">
        <span className="grid size-5 place-items-center rounded-full bg-green text-[11px] text-white">✓</span> {ok}
      </p>
    );
  return null;
}

// ───────────── Photo ─────────────

const OUT = 320; // saved size in px
const VIEW = 220; // editor size in px

/** Pick a photo, zoom and drag it into the circle, then save a small square JPEG. */
export function PhotoEditor({ name, image }: { name: string; image: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [state, setState] = useState<AccountState>(undefined);
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState(image);

  // Geometry: the image covers the circle at zoom 1; offsets are clamped so no gap ever shows.
  const geom = (size: number) => {
    if (!img) return null;
    const base = Math.max(size / img.width, size / img.height) * zoom;
    const w = img.width * base;
    const h = img.height * base;
    const maxX = (w - size) / 2;
    const maxY = (h - size) / 2;
    const k = size / VIEW;
    const x = Math.max(-maxX, Math.min(maxX, pos.x * k));
    const y = Math.max(-maxY, Math.min(maxY, pos.y * k));
    return { w, h, dx: (size - w) / 2 + x, dy: (size - h) / 2 + y };
  };

  useEffect(() => {
    const c = canvas.current;
    const g = geom(VIEW * 2);
    if (!c || !img || !g) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, g.dx, g.dy, g.w, g.h);
  });

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return setState({ error: "Choose an image file (JPG, PNG or WebP)." });
    if (f.size > 15_000_000) return setState({ error: "That photo is very large. Try one under 15 MB." });
    const url = URL.createObjectURL(f);
    const el = new Image();
    el.onload = () => {
      setImg(el);
      setZoom(1);
      setPos({ x: 0, y: 0 });
      setState(undefined);
    };
    el.onerror = () => setState({ error: "We couldn't read that image. Try another photo." });
    el.src = url;
  };

  const save = () => {
    if (!img) return;
    const out = document.createElement("canvas");
    out.width = OUT;
    out.height = OUT;
    const g = geom(OUT)!;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#fbf4e8";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, g.dx, g.dy, g.w, g.h);
    out.toBlob(
      (blob) => {
        if (!blob) return setState({ error: "Something went wrong preparing the photo." });
        const fd = new FormData();
        fd.append("photo", new File([blob], "avatar.jpg", { type: "image/jpeg" }));
        start(async () => {
          const r = await avatarAction(undefined, fd);
          setState(r);
          if (r?.ok) {
            setCurrent(r.image ?? null);
            setImg(null);
            router.refresh();
          }
        });
      },
      "image/jpeg",
      0.88,
    );
  };

  const remove = () =>
    start(async () => {
      const r = await removeAvatarAction();
      setState(r);
      setCurrent(null);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      {img ? (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div
            className="relative cursor-grab touch-none overflow-hidden rounded-full shadow-lg ring-4 ring-amber active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              setPos({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
            }}
            onPointerUp={() => (drag.current = null)}
            role="img"
            aria-label="Photo preview. Drag to reposition."
          >
            <canvas ref={canvas} width={VIEW * 2} height={VIEW * 2} style={{ width: VIEW, height: VIEW }} />
          </div>
          <div className="flex w-full max-w-xs flex-col gap-3">
            <p className="text-sm text-ink-muted">Drag the photo to position it, and use the slider to zoom.</p>
            <label className="flex items-center gap-3 text-sm font-bold">
              <span aria-hidden="true">−</span>
              <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-green" aria-label="Zoom" />
              <span aria-hidden="true">+</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={save} disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save photo"}</button>
              <button type="button" onClick={() => setImg(null)} className="btn-outline">Cancel</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <div className="relative">
            <Avatar name={name} size={96} src={current} />
            <button type="button" onClick={() => input.current?.click()} className="absolute -right-1 -bottom-1 grid size-9 place-items-center rounded-full border-2 border-white bg-amber text-ink shadow" aria-label="Change photo">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z" /></svg>
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => input.current?.click()} className="btn-primary">{current ? "Change photo" : "Upload a photo"}</button>
              {current && <button type="button" onClick={remove} disabled={pending} className="btn-outline">Remove</button>}
            </div>
            <p className="text-xs text-ink-muted">A clear photo of your face builds trust. JPG, PNG or WebP.</p>
          </div>
        </div>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <Note state={state} ok={current ? "Photo saved. It now shows across the platform." : "Photo removed."} />
    </div>
  );
}

// ───────────── Profile ─────────────

export function ProfileForm({ name, country }: { name: string; country: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(profileAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="label">Full name</label>
          <input id="name" name="name" defaultValue={name} required maxLength={80} autoComplete="name" className="field" />
        </div>
        <div>
          <label htmlFor="country" className="label">Country</label>
          <input id="country" name="country" defaultValue={country} maxLength={60} autoComplete="country-name" className="field" placeholder="e.g. Ghana" list="countries" />
          <datalist id="countries">
            {["Ghana", "Nigeria", "Sierra Leone", "Liberia", "The Gambia", "Côte d'Ivoire", "Togo", "Burkina Faso", "Kenya", "South Africa", "United Kingdom", "United States", "Canada"].map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>
      <Note state={state} ok="Saved." />
      <button className="btn-primary self-start" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
    </form>
  );
}

export function ExpertProfileForm({ headline, bio, skills, litRetriever = false }: { headline: string; bio: string; skills: string[]; litRetriever?: boolean }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(expertProfileAction, undefined);
  const [list, setList] = useState(skills);
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const s = raw.replace(/,$/, "").trim();
    if (s && list.length < 15 && !list.some((x) => x.toLowerCase() === s.toLowerCase())) setList([...list, s.slice(0, 30)]);
    setDraft("");
  };
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="skills" value={list.join(",")} />
      <div>
        <label htmlFor="headline" className="label">Headline</label>
        <input id="headline" name="headline" defaultValue={headline} required maxLength={120} className="field" placeholder="e.g. Biostatistician · PhD, University of Ghana" />
        <p className="mt-1 text-xs text-ink-muted">Shown under your name on services, proposals and in search.</p>
      </div>
      <div>
        <label htmlFor="bio" className="label">About you</label>
        <textarea id="bio" name="bio" defaultValue={bio} rows={5} maxLength={2000} className="field" placeholder="Your research background, methods you're strongest in, and the kind of projects you enjoy." />
      </div>
      <div>
        <label htmlFor="skill" className="label">Skills <span className="font-normal text-ink-muted">(up to 15; these match you to jobs)</span></label>
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-white p-2 focus-within:border-green">
          {list.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-full bg-green px-3 py-1 text-sm font-medium text-white">
              {s}
              <button type="button" onClick={() => setList(list.filter((x) => x !== s))} aria-label={`Remove ${s}`} className="grid size-5 place-items-center rounded-full hover:bg-white/20">×</button>
            </span>
          ))}
          <input
            id="skill"
            value={draft}
            onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Backspace" && !draft && list.length) setList(list.slice(0, -1));
            }}
            onBlur={() => draft && add(draft)}
            placeholder="Type a skill and press Enter"
            className="min-w-40 flex-1 px-2 py-1.5 outline-none"
          />
        </div>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-line bg-white px-4 py-3 text-sm has-checked:border-green has-checked:bg-green-tint">
        <input type="checkbox" name="litRetriever" value="1" defaultChecked={litRetriever} className="mt-0.5 size-4 flex-none accent-green" />
        <span>
          <b>Literature retriever</b>
          <span className="block text-ink-muted">Take private literature retrieval assignments: The True Scholars assigns you a client&apos;s research question to find papers for, at a set price. These are never posted on the job board.</span>
        </span>
      </label>
      <Note state={state} ok="Expert profile saved." />
      <button className="btn-primary self-start" disabled={pending}>{pending ? "Saving…" : "Save expert profile"}</button>
    </form>
  );
}

// ───────────── Password ─────────────

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(passwordAction, undefined);
  const [show, setShow] = useState(false);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      form.current?.reset();
      setNext("");
      setConfirm("");
    }
  }, [state]);
  const s = strength(next);
  const type = show ? "text" : "password";
  return (
    <form ref={form} action={action} className="flex flex-col gap-4">
      {hasPassword && (
        <div>
          <label htmlFor="current" className="label">Current password</label>
          <input id="current" name="current" type={type} required autoComplete="current-password" className="field" />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="next" className="label">New password</label>
          <input id="next" name="next" type={type} required minLength={8} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="field" />
          <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={`h-1.5 rounded-full ${next && s >= i ? (s >= 3 ? "bg-green" : "bg-amber") : "bg-line"}`} />
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-muted">{next ? ["Too weak", "Weak", "Fair", "Good", "Strong"][s] : "At least 8 characters, with a number or symbol."}</p>
        </div>
        <div>
          <label htmlFor="confirm" className="label">Confirm new password</label>
          <input id="confirm" name="confirm" type={type} required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field" />
          {confirm && <p className={`mt-1 text-xs font-bold ${confirm === next ? "text-green" : "text-amber-deep"}`}>{confirm === next ? "✓ Passwords match" : "Doesn't match yet"}</p>}
        </div>
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="size-4 accent-green" /> Show passwords
      </label>
      <Note state={state} ok="Password changed." />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "Updating…" : hasPassword ? "Change password" : "Set a password"}</button>
        <span className="text-xs text-ink-muted">For your security, you&apos;ll be signed out everywhere and asked to log in with the new password.</span>
      </div>
    </form>
  );
}
