import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { newQuestion, type Question } from "@/lib/qual";
import { listStudies,
  QualError, audioFor, ownerExplanation, publicExplanation, saveExplanation, createStudy, deleteResponse, deleteStudy, editTranscript, getStudy, hasUnpublishedChanges, listResponses, publicStudy,
  publishStudy, resumeResponse, saveAnswer, saveAudio, saveDraft, setFlag, startResponse, submitResponse, transcribeResponse, transcribeStudy, usable,
} from "@/server/qual";
import { canUse, grantToolAccess, peekToolAccess, toolAccessFor } from "@/server/toolAccess";

let db: DB;
let owner: { id: string; roles: string[] };

const q = (type: Question["type"], text: string, extra: Partial<Question> = {}): Question => ({ ...newQuestion(type), text, ...extra });

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [u] = await d.insert(schema.users).values({ email: "ama@example.com", name: "Ama Owusu" }).returning();
  owner = { id: u.id, roles: ["CLIENT"] };
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPGRAM_API_KEY;
});

async function liveStudy() {
  const id = await createStudy(db, owner.id, { title: "Farmers and rainfall" });
  const qs = [q("section", "About you"), q("choice", "Region", { options: ["Upper West", "Volta"] }), q("voice", "How has rainfall changed?"), q("text", "Anything else?", { required: false }), q("rating", "How worried are you?", { scaleMax: 5 })];
  const s = (await getStudy(db, owner.id, id))!;
  await saveDraft(db, owner.id, id, { title: s.title, intro: s.intro, questions: qs, settings: { askName: "required" } });
  await publishStudy(db, owner.id, id);
  const st = (await getStudy(db, owner.id, id))!;
  return { id, token: st.token, qs };
}

describe("studies", () => {
  it("won't publish an empty or half-written study", async () => {
    const id = await createStudy(db, owner.id);
    await expect(publishStudy(db, owner.id, id)).rejects.toThrow(/at least one question/);
    const s = (await getStudy(db, owner.id, id))!;
    await saveDraft(db, owner.id, id, { title: "T", intro: s.intro, questions: [q("choice", "Pick", { options: ["only one"] })], settings: {} });
    await expect(publishStudy(db, owner.id, id)).rejects.toThrow(/two options/);
    await expect(saveDraft(db, owner.id, id, { title: " ", intro: "", questions: [], settings: {} })).rejects.toThrow(/title/);
  });

  it("respondents see the published copy while the researcher edits the draft", async () => {
    const { id, token, qs } = await liveStudy();
    const s = (await getStudy(db, owner.id, id))!;
    expect(hasUnpublishedChanges(s)).toBe(false);
    await saveDraft(db, owner.id, id, { title: "Changed title", intro: s.intro, questions: qs, settings: s.settings });
    expect(hasUnpublishedChanges((await getStudy(db, owner.id, id))!)).toBe(true);
    expect((await publicStudy(db, token))!.study.title).toBe("Farmers and rainfall");
  });

  it("other people can't open someone's study", async () => {
    const { id } = await liveStudy();
    expect(await getStudy(db, "someone-else", id)).toBeNull();
    await expect(listResponses(db, "someone-else", id)).rejects.toBeInstanceOf(QualError);
  });
});

describe("responding", () => {
  it("collects answers and audio, resumes, and checks required questions on submit", async () => {
    const { id, token, qs } = await liveStudy();
    await expect(startResponse(db, token, {})).rejects.toThrow(/name/);
    const { responseId, secret } = await startResponse(db, token, { name: "Kwame" });
    await saveAnswer(db, token, responseId, secret, qs[1].id, { choice: "Volta" });
    await expect(saveAnswer(db, token, responseId, secret, qs[1].id, { choice: "Ashanti" })).rejects.toThrow(/options/);
    await expect(saveAnswer(db, token, responseId, "wrong-secret-wrong-secret", qs[1].id, { choice: "Volta" })).rejects.toThrow(/couldn't find/);
    await expect(submitResponse(db, token, responseId, secret)).rejects.toThrow(/rainfall/);
    await saveAudio(db, token, responseId, secret, qs[2].id, new Uint8Array([1, 2, 3]), "audio/webm;codecs=opus", 42.4);
    await saveAudio(db, token, responseId, secret, qs[2].id, new Uint8Array([4, 5, 6, 7]), "audio/webm", 50); // a second take replaces the first
    expect((await db.select().from(schema.qualAudio)).length).toBe(1);
    await saveAnswer(db, token, responseId, secret, qs[4].id, { rating: 4 });
    const resumed = await resumeResponse(db, token, responseId, secret);
    expect(resumed[qs[2].id].audio).toEqual({ seconds: 50 });
    await submitResponse(db, token, responseId, secret);
    await expect(saveAnswer(db, token, responseId, secret, qs[3].id, { text: "late" })).rejects.toThrow(/already been submitted/);

    const rs = await listResponses(db, owner.id, id);
    expect(rs[0].n).toBe(1);
    expect((await listStudies(db, owner.id)).find((x) => x.id === id)!.responses).toBe(1);
    expect(rs[0].answers[qs[1].id].choice).toBe("Volta");
    const audio = await audioFor(db, owner.id, rs[0].id, qs[2].id);
    expect([...audio!.bytes]).toEqual([4, 5, 6, 7]);
    const notes = await db.select().from(schema.notifications);
    expect(notes[0].kind).toBe("STUDY_RESPONSE");
  });

  it("rejects non-audio uploads and closed studies", async () => {
    const { token, qs } = await liveStudy();
    const { responseId, secret } = await startResponse(db, token, { name: "A" });
    await expect(saveAudio(db, token, responseId, secret, qs[2].id, new Uint8Array([1]), "text/html", 1)).rejects.toThrow(/audio/);
    await expect(saveAudio(db, token, responseId, secret, qs[1].id, new Uint8Array([1]), "audio/webm", 1)).rejects.toThrow(/recording/);
  });
});

describe("researcher tools", () => {
  async function withResponse() {
    const study = await liveStudy();
    const { responseId, secret } = await startResponse(db, study.token, { name: "Esi" });
    await saveAnswer(db, study.token, responseId, secret, study.qs[1].id, { choice: "Upper West" });
    await saveAudio(db, study.token, responseId, secret, study.qs[2].id, new Uint8Array([9, 9]), "audio/mp4", 30);
    await saveAnswer(db, study.token, responseId, secret, study.qs[4].id, { rating: 2 });
    await submitResponse(db, study.token, responseId, secret);
    return { ...study, responseId };
  }

  it("transcribes with Deepgram, records failures, and keeps edits", async () => {
    const { id, qs, responseId } = await withResponse();
    process.env.DEEPGRAM_API_KEY = "test";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "The rains come late now." }] }] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribeResponse(db, responseId)).toEqual({ done: 1, failed: 0 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("language=en");
    expect(fetchMock.mock.calls[0][1].headers["content-type"]).toBe("audio/mp4");
    let r = (await listResponses(db, owner.id, id))[0];
    expect(r.answers[qs[2].id]).toMatchObject({ transcript: "The rains come late now.", tStatus: "done" });

    await editTranscript(db, owner.id, responseId, qs[2].id, "The rains now come late.");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    expect(await transcribeStudy(db, owner.id, id)).toEqual({ done: 0, failed: 0, remaining: 0 }); // edited answers are left alone
    r = (await listResponses(db, owner.id, id))[0];
    expect(r.answers[qs[2].id]).toMatchObject({ transcript: "The rains now come late.", tStatus: "edited" });
  });

  it("flags test responses out of the usable set, and deletes responses with their audio", async () => {
    const { id, responseId } = await withResponse();
    await setFlag(db, owner.id, responseId, true);
    expect(usable(await listResponses(db, owner.id, id))).toHaveLength(0);
    await deleteResponse(db, owner.id, responseId);
    expect(await db.select().from(schema.qualAudio)).toHaveLength(0);
    await deleteStudy(db, owner.id, id);
    expect(await db.select().from(schema.qualStudies)).toHaveLength(0);
  });
});

describe("tool access", () => {
  it("has its own two-day trial per tool and can be granted", async () => {
    const t0 = new Date("2026-11-06T12:00:00Z");
    expect((await peekToolAccess(db, "qual", owner, t0)).access.kind).toBe("new");
    expect((await toolAccessFor(db, "qual", owner, t0)).kind).toBe("trial");
    const later = new Date(t0.getTime() + 49 * 3_600_000);
    expect(canUse(await toolAccessFor(db, "qual", owner, later))).toBe(false);
    await grantToolAccess(db, "qual", "ama@example.com", 10, "", later);
    expect((await toolAccessFor(db, "qual", owner, later)).kind).toBe("granted");
  });
});

describe("spoken explanations", () => {
  it("lets the researcher attach a recording to a question that respondents can play once published", async () => {
    const { id, token, qs } = await liveStudy();
    const voice = qs.find((x) => x.type === "voice")!;
    const ref = await saveExplanation(db, owner.id, id, new Uint8Array([1, 2, 3, 4]), "audio/webm;codecs=opus", 42);
    expect(ref.key.startsWith(`qual/${id}/_explain/`)).toBe(true);
    expect(ref).toMatchObject({ mime: "audio/webm", seconds: 42 });
    expect((await ownerExplanation(db, owner.id, id, ref.key))!.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));

    const s = (await getStudy(db, owner.id, id))!;
    const withExplain = (s.questions as Question[]).map((x) => (x.id === voice.id ? { ...x, explain: ref } : x));
    await saveDraft(db, owner.id, id, { title: s.title, intro: s.intro, questions: withExplain, settings: s.settings });
    expect(await publicExplanation(db, token, voice.id)).toBeNull(); // not published yet
    await publishStudy(db, owner.id, id);
    expect((await publicExplanation(db, token, voice.id))!.mimeType).toBe("audio/webm");
    expect(await publicExplanation(db, token, "nope")).toBeNull();
  });

  it("won't point a question at another study's file, and keeps explanations private to the owner", async () => {
    const a = await liveStudy();
    const b = await liveStudy();
    const theirs = await saveExplanation(db, owner.id, b.id, new Uint8Array([9]), "audio/mp4", 5);
    const s = (await getStudy(db, owner.id, a.id))!;
    const qs = (s.questions as Question[]).map((x) => (x.type === "voice" ? { ...x, explain: theirs } : x));
    await saveDraft(db, owner.id, a.id, { title: s.title, intro: s.intro, questions: qs, settings: s.settings });
    expect(((await getStudy(db, owner.id, a.id))!.questions as Question[]).find((x) => x.type === "voice")!.explain).toBeNull();
    expect(await ownerExplanation(db, owner.id, a.id, theirs.key)).toBeNull();

    const [other] = await db.insert(schema.users).values({ email: "kwame@example.com" }).returning();
    await expect(saveExplanation(db, other.id, a.id, new Uint8Array([1]), "audio/webm", 1)).rejects.toThrow();
    await expect(saveExplanation(db, owner.id, a.id, new Uint8Array([1]), "text/html", 1)).rejects.toThrow(/audio/);
  });
});

