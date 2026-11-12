import type { Metadata } from "next";
import Link from "next/link";
import { emailPrefAction } from "@/app/actions/account";
import { ExpertProfileForm, PasswordForm, PhotoEditor, ProfileForm } from "@/components/AccountForms";
import { AlertSettings } from "@/components/AlertSettings";
import { Icon, type IconName } from "@/components/Icons";
import { Avatar } from "@/components/UserAvatar";
import { getDb } from "@/db";
import { memberSince } from "@/lib/time";
import { getAccount } from "@/server/account";
import { requireUser } from "@/server/guards";
import { LEVEL_INFO, type Level } from "@/server/levels";

export const metadata: Metadata = { title: "Account settings" };
export const dynamic = "force-dynamic";

export default async function Settings() {
  const user = await requireUser();
  const a = await getAccount(getDb(), user.id);
  if (!a) return null;
  const sections: { id: string; label: string; icon: IconName }[] = [
    { id: "profile", label: "Profile", icon: "spark" },
    ...(a.expert ? [{ id: "expert", label: "Expert profile", icon: "shield" as IconName }] : []),
    { id: "password", label: "Password", icon: "lock" },
    { id: "alerts", label: "Notifications", icon: "bell" },
  ];

  return (
    <>
      <section className="bg-green text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-5 px-4 py-8 sm:px-6">
          <Avatar name={a.name ?? a.email} size={72} src={a.image} tone="amber" />
          <div className="min-w-0 flex-1">
            <span className="text-xs font-bold tracking-wider text-amber uppercase">Account settings</span>
            <h1 className="text-3xl font-extrabold break-words text-white sm:truncate">{a.name ?? "Your account"}</h1>
            <p className="text-on-green-muted">
              {a.email} · Member since {memberSince(a.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {a.roles.map((r) => (
              <span key={r} className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">{r.charAt(0) + r.slice(1).toLowerCase()}</span>
            ))}
            {a.expert && <span className="rounded-full bg-amber px-3 py-1 text-xs font-bold text-ink">{LEVEL_INFO[a.expert.level as Level].name}</span>}
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Settings sections" className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:sticky lg:top-6 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="inline-flex shrink-0 items-center gap-2.5 rounded-full border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink no-underline hover:border-green lg:rounded-sm lg:border-transparent lg:bg-transparent lg:hover:bg-white">
              <Icon name={s.icon} size={16} className="text-green" /> {s.label}
            </a>
          ))}
          <Link href="/settings/api" className="inline-flex shrink-0 items-center gap-2.5 rounded-full border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink no-underline lg:rounded-sm lg:border-transparent lg:bg-transparent lg:hover:bg-white">
            <Icon name="lock" size={16} className="text-green" /> Developer API
          </Link>
          {a.roles.includes("EXPERT") && (
            <Link href="/earnings" className="inline-flex shrink-0 items-center gap-2.5 rounded-full border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink no-underline lg:rounded-sm lg:border-transparent lg:bg-transparent lg:hover:bg-white">
              <Icon name="wallet" size={16} className="text-green" /> Payout account
            </Link>
          )}
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          <Card id="profile" title="Profile" hint="How you appear to experts, clients and our team.">
            <PhotoEditor name={a.name ?? a.email} image={a.image} />
            <div className="border-t border-line pt-5">
              <ProfileForm name={a.name ?? ""} country={a.country ?? ""} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm bg-parchment px-4 py-3 text-sm">
              <span><span className="text-ink-muted">Email</span> <b>{a.email}</b></span>
              <span className="text-xs text-ink-muted">To change your email, write to <a href="mailto:hello@thetruescholars.com" className="font-bold text-green">hello@thetruescholars.com</a></span>
            </div>
          </Card>

          {a.expert && (
            <Card id="expert" title="Expert profile" hint="Clients read this before they hire you.">
              <ExpertProfileForm headline={a.expert.headline} bio={a.expert.bio ?? ""} skills={a.expert.skills} litRetriever={a.expert.litRetriever} />
            </Card>
          )}

          <Card id="password" title={a.hasPassword ? "Change password" : "Set a password"} hint={a.hasPassword ? "Changing it signs you out on every other device." : "You signed up with Google. Add a password to also sign in with your email."}>
            <PasswordForm hasPassword={a.hasPassword} />
          </Card>

          <Card id="alerts" title="Notifications" hint="Choose how we tell you about messages, orders and payments.">
            <form action={emailPrefAction} className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-line p-4">
              <input type="hidden" name="on" value={a.emailNotifications ? "0" : "1"} />
              <div>
                <div className="font-bold">Email notifications</div>
                <p className="text-sm text-ink-muted">{a.emailNotifications ? `We email ${a.email} about new messages, orders, proposals and payments.` : "Emails are off. You'll still see everything in the app."}</p>
              </div>
              <button role="switch" aria-checked={a.emailNotifications} className={`relative h-7 w-12 flex-none rounded-full transition-colors ${a.emailNotifications ? "bg-green" : "bg-line"}`} aria-label="Email notifications">
                <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${a.emailNotifications ? "left-6" : "left-1"}`} />
              </button>
            </form>
            <div className="flex flex-col gap-2 rounded-sm border border-line p-4">
              <div className="font-bold">On this device</div>
              <p className="text-sm text-ink-muted">A sound when a message arrives, and alerts on your computer when the tab is in the background.</p>
              <AlertSettings />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Card({ id, title, hint, children }: { id: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card flex scroll-mt-6 flex-col gap-5" aria-labelledby={`${id}-h`}>
      <div>
        <h2 id={`${id}-h`} className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-ink-muted">{hint}</p>
      </div>
      {children}
    </section>
  );
}
