"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPasswordAction, resendVerificationAction, resetPasswordAction, signInAction, signUpAction, type FormState } from "@/app/actions/auth";
import { useState, useTransition } from "react";

function ErrorNote({ state }: { state: FormState }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-sm bg-amber-tint px-4 py-3 text-sm text-amber-deep">
      {state.error}
    </p>
  );
}

export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signInAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field" />
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="password" className="label">Password</label>
          <Link href="/forgot-password" className="text-[13px] font-bold text-green">Forgot your password?</Link>
        </div>
        <input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} className="field" />
      </div>
      <ErrorNote state={state} />
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm text-ink-muted">
        New here? <Link href={next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up"} className="font-bold text-green">Create an account</Link>
      </p>
    </form>
  );
}

export function SignUpForm({ asExpert, next }: { asExpert: boolean; next?: string }) {
  const [state, action, pending] = useActionState(signUpAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="label">I want to…</legend>
        <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-line bg-white px-3 py-3 text-sm has-checked:border-green has-checked:bg-green-tint">
          <input type="radio" name="intent" value="client" defaultChecked={!asExpert} className="accent-green" />
          Get research help
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-line bg-white px-3 py-3 text-sm has-checked:border-green has-checked:bg-green-tint">
          <input type="radio" name="intent" value="expert" defaultChecked={asExpert} className="accent-green" />
          Offer my expertise
        </label>
      </fieldset>
      <div>
        <label htmlFor="name" className="label">Full name</label>
        <input id="name" name="name" autoComplete="name" required minLength={2} className="field" />
      </div>
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field" />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className="field" />
        <p className="mt-1 text-xs text-ink-muted">At least 8 characters.</p>
      </div>
      <ErrorNote state={state} />
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </button>
      <p className="text-center text-sm text-ink-muted">
        Already have an account? <Link href={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"} className="font-bold text-green">Sign in</Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, undefined);
  if (state?.sent)
    return (
      <p role="status" className="rounded-sm bg-green-tint px-4 py-3 text-sm text-green">
        If an account uses that email, a link to reset the password is on its way. It works for one hour. Check your spam folder if it doesn&apos;t arrive.
      </p>
    );
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field" />
      </div>
      {state?.error && <p role="alert" className="rounded-sm bg-amber-tint px-4 py-3 text-sm text-amber-deep">{state.error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>{pending ? "Sending…" : "Email me a reset link"}</button>
      <p className="text-center text-sm text-ink-muted"><Link href="/sign-in" className="font-bold text-green">Back to sign in</Link></p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label htmlFor="password" className="label">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className="field" />
      </div>
      <div>
        <label htmlFor="confirm" className="label">Type it again</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className="field" />
      </div>
      {state?.error && <p role="alert" className="rounded-sm bg-amber-tint px-4 py-3 text-sm text-amber-deep">{state.error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Save my new password"}</button>
    </form>
  );
}

/** The banner asking people who signed up with a password to confirm their email. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber/40 bg-amber-tint px-4 py-3 text-sm sm:flex-row sm:items-center">
      <span className="flex-1 text-amber-deep"><b>Please confirm your email.</b> We sent a link to {email}. It keeps your account safe and lets you reset your password.</span>
      {msg ? <span className={msg.error ? "text-red-700" : "font-bold text-green"}>{msg.error ?? msg.ok}</span> : (
        <button type="button" disabled={busy} onClick={() => start(async () => setMsg(await resendVerificationAction()))} className="btn-outline min-h-9 border border-amber/60 px-4 text-sm">{busy ? "Sending…" : "Send it again"}</button>
      )}
    </div>
  );
}
