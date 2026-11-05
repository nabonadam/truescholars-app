import Link from "next/link";
import { auth } from "@/auth";
import { signOutAction } from "@/app/actions/auth";
import { Logo } from "./Logo";

export async function Header() {
  const session = await auth().catch(() => null); // no database yet → treat as signed out
  const user = session?.user;
  const link = "text-sm font-medium text-on-green-muted no-underline hover:text-white whitespace-nowrap";
  return (
    <header className="bg-green text-white">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6" aria-label="Main">
        <Link href="/" className="mr-auto no-underline">
          <Logo onDark />
        </Link>
        <Link href="/services" className={link}>Find experts</Link>
        {user ? (
          <>
            <Link href="/orders" className={`${link} hidden md:inline`}>Orders</Link>
            {user.roles.includes("EXPERT") && <Link href="/expert/services" className={`${link} hidden md:inline`}>My services</Link>}
            {user.roles.includes("ADMIN") && <Link href="/admin/applications" className={`${link} hidden md:inline`}>Admin</Link>}
            <Link href="/dashboard" className={link}>Dashboard</Link>
            <form action={signOutAction}>
              <button className="inline-flex min-h-11 items-center rounded-full border border-white/30 px-4 text-sm font-bold text-white">Sign out</button>
            </form>
          </>
        ) : (
          <>
            <Link href="/sign-in" className="text-sm font-medium text-white no-underline">Log in</Link>
            <Link href="/sign-up" className="btn-amber">Join free</Link>
          </>
        )}
      </nav>
    </header>
  );
}
