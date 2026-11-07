import { notFound } from "next/navigation";
import { Builder } from "@/components/qual/Builder";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { getStudy, hasUnpublishedChanges, studyQuestions, studySettings } from "@/server/qual";
import { canUse, toolAccessFor } from "@/server/toolAccess";

export const metadata = { title: "Build · Qualitative Studio" };

export default async function BuildStudy({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const s = await getStudy(db, user.id, id);
  if (!s) notFound();
  const access = await toolAccessFor(db, "qual", user);
  return (
    <Builder
      id={s.id}
      token={s.token}
      status={s.status}
      unpublished={hasUnpublishedChanges(s)}
      canPublish={canUse(access)}
      initial={{ title: s.title, intro: s.intro, questions: studyQuestions(s), settings: studySettings(s) }}
    />
  );
}
