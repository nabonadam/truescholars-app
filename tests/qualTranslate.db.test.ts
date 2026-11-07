import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { analysisText, newQuestion, translationOf, type Question } from "@/lib/qual";
import { createStudy, editTranscript, getStudy, listResponses, publishStudy, saveAnswer, saveAudio, saveDraft, startResponse, submitResponse, transcribeResponse } from "@/server/qual";
import { cases } from "@/server/qualAnalysis";
import { responsesCsv, transcriptsZip } from "@/server/qualExport";
import { pendingTranslations, translateResponse, translateStudy } from "@/server/qualTranslate";
import { fieldQuestions } from "@/server/qualExport";
import { unzipSync, strFromU8 } from "fflate";

let db: DB;
let owner: { id: string; roles: string[] };
const q = (type: Question["type"], text: string, extra: Partial<Question> = {}): Question => ({ ...newQuestion(type), text, ...extra });

// a fake Deepgram (Mandarin transcript) and a fake Claude (translation)
const EN: Record<string, string> = { "雨季来得越来越晚了。": "The rainy season comes later and later.", "我们种了两次。": "We planted twice.", "我们种了三次。": "We planted three times." };
const anthropicCalls: string[] = [];
function fakeFetch(fail = false) {
  return vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).includes("deepgram")) return new Response(JSON.stringify({ metadata: { duration: 12 }, results: { channels: [{ alternatives: [{ transcript: "雨季来得越来越晚了。" }] }] } }), { status: 200 });
    const body = JSON.parse(String(init.body));
    anthropicCalls.push(body.messages[0].content);
    if (fail) return new Response("busy", { status: 529 });
    const src = String(body.messages[0].content).match(/<answer>\n([\s\S]*)\n<\/answer>/)![1];
    return new Response(JSON.stringify({ content: [{ type: "text", text: EN[src] ?? src }], stop_reason: "end_turn", usage: { input_tokens: 50, output_tokens: 20 } }), { status: 200 });
  });
}

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [u] = await d.insert(schema.users).values({ email: "ama@example.com", name: "Ama Owusu" }).returning();
  owner = { id: u.id, roles: ["CLIENT"] };
  process.env.DEEPGRAM_API_KEY = "dg";
  process.env.ANTHROPIC_API_KEY = "sk";
  anthropicCalls.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

async function chineseStudy(translate = true) {
  const id = await createStudy(db, owner.id, { title: "Farmers and rainfall" });
  const qs = [q("voice", "雨水有什么变化？"), q("text", "还有什么要补充的吗？", { required: false }), q("choice", "地区", { options: ["北方", "南方"] })];
  const s = (await getStudy(db, owner.id, id))!;
  await saveDraft(db, owner.id, id, { title: s.title, intro: s.intro, questions: qs, settings: { language: "zh-CN", translate } });
  await publishStudy(db, owner.id, id);
  const token = (await getStudy(db, owner.id, id))!.token;
  const { responseId, secret } = await startResponse(db, token, {});
  await saveAudio(db, token, responseId, secret, qs[0].id, new Uint8Array(3000), "audio/webm", 12);
  await saveAnswer(db, token, responseId, secret, qs[1].id, { text: "我们种了两次。" });
  await saveAnswer(db, token, responseId, secret, qs[2].id, { choice: "北方" });
  await submitResponse(db, token, responseId, secret);
  return { id, qs, responseId };
}

describe("translating answers into English", () => {
  it("transcribes Mandarin, translates open answers, keeps the originals, and analyses the English", async () => {
    const fetchMock = fakeFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { id, qs, responseId } = await chineseStudy();
    await transcribeResponse(db, responseId);
    expect(String(fetchMock.mock.calls[0][0])).toContain("language=zh-CN");
    await translateResponse(db, owner.id, id, responseId);
    expect(anthropicCalls).toHaveLength(2); // the voice transcript and the typed answer; not the choice
    expect(anthropicCalls[0]).toContain("Chinese, Mandarin (Simplified)");

    let [r] = await listResponses(db, owner.id, id);
    expect(r.answers[qs[0].id]).toMatchObject({ transcript: "雨季来得越来越晚了。", translation: "The rainy season comes later and later.", trStatus: "done" });
    expect(translationOf(qs[1], r.answers[qs[1].id])).toBe("We planted twice.");
    expect(analysisText(qs[2], r.answers[qs[2].id])).toBe("北方");
    expect(pendingTranslations(fieldQuestions((await getStudy(db, owner.id, id))!), [r])).toBe(0);

    const c = await cases(db, owner.id, id);
    expect(c.list[0].text).toContain("The rainy season comes later and later.");
    expect(c.list[0].text).not.toContain("雨季");

    const csv = responsesCsv((await getStudy(db, owner.id, id))!, [r]);
    expect(csv).toContain("(English translation)");
    expect(csv).toContain("雨季来得越来越晚了。");
    const zip = unzipSync(transcriptsZip((await getStudy(db, owner.id, id))!, [r]) as Uint8Array);
    const txt = strFromU8(Object.values(zip)[0]);
    expect(txt).toContain("雨季来得越来越晚了。");
    expect(txt).toContain("[English translation]");

    // editing the transcript makes the old translation stale; translating again updates it
    await editTranscript(db, owner.id, responseId, qs[0].id, "我们种了三次。");
    [r] = await listResponses(db, owner.id, id);
    expect(translationOf(qs[0], r.answers[qs[0].id])).toBeNull();
    expect(analysisText(qs[0], r.answers[qs[0].id])).toBe("我们种了三次。");
    expect(await translateStudy(db, owner.id, id)).toEqual({ done: 1, failed: 0, remaining: 0 });
    [r] = await listResponses(db, owner.id, id);
    expect(translationOf(qs[0], r.answers[qs[0].id])).toBe("We planted three times.");
  });

  it("does nothing unless the study asks for it, and records failures for a retry", async () => {
    vi.stubGlobal("fetch", fakeFetch());
    const off = await chineseStudy(false);
    expect(await translateResponse(db, owner.id, off.id, off.responseId)).toEqual({ done: 0, failed: 0 });
    expect(anthropicCalls).toHaveLength(0);

    vi.stubGlobal("fetch", fakeFetch(true));
    const on = await chineseStudy(true);
    expect(await translateResponse(db, owner.id, on.id, on.responseId)).toEqual({ done: 0, failed: 1 }); // the typed answer; the recording isn't transcribed yet
    let [r] = await listResponses(db, owner.id, on.id);
    expect(r.answers[on.qs[1].id]).toMatchObject({ trStatus: "failed" });
    vi.stubGlobal("fetch", fakeFetch());
    expect((await translateStudy(db, owner.id, on.id)).done).toBe(1);
    [r] = await listResponses(db, owner.id, on.id);
    expect(translationOf(on.qs[1], r.answers[on.qs[1].id])).toBe("We planted twice.");
  });
});
