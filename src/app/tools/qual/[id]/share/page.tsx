import Link from "next/link";
import { notFound } from "next/navigation";
import { ShareLink } from "@/components/qual/ShareLink";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { getStudy } from "@/server/qual";

export const metadata = { title: "Share · Qualitative Studio" };

export default async function ShareStudy({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const s = await getStudy(getDb(), user.id, id);
  if (!s) notFound();
  if (s.status === "DRAFT") {
    return (
      <div className="card mx-auto max-w-xl p-8 text-center">
        <h2 className="text-2xl font-extrabold">Publish first</h2>
        <p className="mt-2 text-ink-muted">Your study gets its link when you publish it. You can keep editing afterwards.</p>
        <Link href={`/tools/qual/${id}`} className="btn-amber mt-5">Back to the builder</Link>
      </div>
    );
  }
  const url = `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/s/${s.token}`;
  return <ShareLink url={url} title={s.title} closed={s.status === "CLOSED"} />;
}
