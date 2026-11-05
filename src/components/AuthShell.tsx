import { googleSignInAction } from "@/app/actions/auth";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const google = Boolean(process.env.AUTH_GOOGLE_ID);
  return (
    <section className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <div className="card flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-ink-muted">{subtitle}</p>
        </div>
        {google && (
          <>
            <form action={googleSignInAction}>
              <button className="btn-outline w-full border border-line">Continue with Google</button>
            </form>
            <div className="flex items-center gap-3 text-xs text-ink-muted">
              <span className="h-px flex-1 bg-line" />or use email<span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}
        {children}
      </div>
    </section>
  );
}
