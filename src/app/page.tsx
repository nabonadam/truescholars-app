import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function Home() {
  const session = await auth().catch(() => null);
  if (session?.user) redirect("/dashboard");

  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6">
      <span className="eyebrow">The True Scholars app</span>
      <h1 className="text-4xl font-extrabold leading-[1.02] sm:text-6xl">
        Research help you can <span className="text-amber-deep">actually trust.</span>
      </h1>
      <p className="max-w-xl text-lg text-ink-muted">
        Hire vetted statisticians, editors and methodologists, with every payment held in escrow until you approve the work.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/sign-up" className="btn-primary">
          Create a free account
        </Link>
        <Link href="/sign-up?as=expert" className="btn-outline">
          Join as an expert
        </Link>
      </div>
    </section>
  );
}
