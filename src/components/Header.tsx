import Link from "next/link";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { unreadNotificationCount } from "@/server/notifications";
import { unreadByOrder } from "@/server/orderRoom";
import { AccountMenu } from "./AccountMenu";
import { HeaderBadges } from "./HeaderBadges";
import { Logo } from "./Logo";

export async function Header() {
  const session = await auth().catch(() => null); // no database yet → treat as signed out
  const user = session?.user;
  const unread = user ? await unreadNotificationCount(getDb(), user.id).catch(() => 0) : 0;
  const unreadMsgs = user
    ? await unreadByOrder(getDb(), user.id)
        .then((m) => [...m.values()].reduce((a, b) => a + b, 0))
        .catch(() => 0)
    : 0;
  const link = "text-sm font-medium text-on-green-muted no-underline hover:text-white whitespace-nowrap";
  return (
    <header className="site-header bg-green text-white">
      <nav className="mx-auto flex max-w-7xl items-center gap-x-1 px-3 py-2.5 sm:gap-x-4 sm:px-6" aria-label="Main">
        <Link href={user ? "/dashboard" : "/"} className="mr-auto min-w-0 no-underline">
          <Logo onDark />
        </Link>
        {user ? (
          <>
            <Link href="/services" className={`${link} hidden lg:inline`}>Find experts</Link>
            {user.roles.includes("EXPERT") && <Link href="/jobs" className={`${link} hidden lg:inline`}>Find work</Link>}
            <Link href="/orders" className={`${link} hidden md:inline`}>Orders</Link>
            <Link href="/jobs/new" className="mr-1 hidden min-h-10 items-center rounded-full bg-amber px-4 text-sm font-bold text-ink no-underline md:inline-flex">Post a job</Link>
            <HeaderBadges messages={unreadMsgs} notifications={unread} />
            <AccountMenu name={user.name ?? ""} email={user.email ?? ""} roles={user.roles} />
          </>
        ) : (
          <>
            <Link href="/services" className={`${link} hidden sm:inline`}>Find experts</Link>
            <Link href="/jobs" className={`${link} hidden md:inline`}>Find work</Link>
            <Link href="/sign-in" className="px-2 text-sm font-medium text-white no-underline">Log in</Link>
            <Link href="/sign-up" className="btn-amber">Join free</Link>
          </>
        )}
      </nav>
    </header>
  );
}
