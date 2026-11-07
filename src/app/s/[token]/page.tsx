import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Respond } from "@/components/qual/Respond";
import { getDb } from "@/db";
import { publicStudy } from "@/server/qual";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const s = await publicStudy(getDb(), token);
  return { title: s ? s.study.title : "Study", robots: { index: false, follow: false } };
}

/** The respondent's view of a study: no account, no site menus, just the questions. */
export default async function StudyLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await publicStudy(getDb(), token);
  if (!s) notFound();
  return <Respond token={token} study={s.study} closed={s.status !== "LIVE"} />;
}
