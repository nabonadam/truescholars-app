"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, signUpAction, type FormState } from "@/app/actions/auth";

function ErrorNote({ state }: { state: FormState }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-sm bg-amber-tint px-4 py-3 text-sm text-amber-deep">
      {state.error}
    </p>
  );
}

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field" />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} className="field" />
      </div>
      <ErrorNote state={state} />
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm text-ink-muted">
        New here? <Link href="/sign-up" className="font-bold text-green">Create an account</Link>
      </p>
    </form>
  );
}

export function SignUpForm({ asExpert }: { asExpert: boolean }) {
  const [state, action, pending] = useActionState(signUpAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
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
        Already have an account? <Link href="/sign-in" className="font-bold text-green">Sign in</Link>
      </p>
    </form>
  );
}
