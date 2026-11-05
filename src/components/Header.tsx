import Link from "next/link";
import { auth } from "@/auth";
import { signOutAction } from "@/app/actions/auth";
import { Logo } from "./Logo";

export async function Header() {
  const session = await auth().catch(() => null); // no database yet → treat as signed out
  return (
    <header className="bg-green text-white">
      <nav className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6" aria-label="Main">
        <Link href="/" className="mr-auto no-underline">
          <Logo onDark />
        </Link>
        {session?.user ? (
          <>
            <Link href="/dashboard" className="hidden text-sm font-medium text-on-green-muted no-underline sm:inline">
              Dashboard
            </Link>
            <form action={signOutAction}>
              <button className="btn border border-white/30 bg-transparent text-white">Sign out</button>
            </form>
          </>
        ) : (
          <>
            <Link href="/sign-in" className="text-sm font-medium text-white no-underline">
              Log in
            </Link>
            <Link href="/sign-up" className="btn-amber">
              Join free
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
