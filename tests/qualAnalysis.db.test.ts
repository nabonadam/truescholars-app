import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { getStudy } from "@/server/qual";
import { cases, editAnalysis, findQuote, getAnalysis, runPhase, saveSetup } from "@/server/qualAnalysis";
import { analysisExport } from "@/server/qualAnalysisExport";
import { createSampleStudy } from "@/server/qualTemplates";

let db: DB;
let owner: string;

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [u] = await d.insert(schema.users).values({ email: "kofi@example.com", name: "Kofi" }).returning();
  owner = u.id;
  process.env.ANTHROPIC_API_KEY = "test";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
});

/** A fake Claude: answers each phase from the prompt, quoting real words from the transcript it was given. */
function fakeClaude(sent: string[]) {
  return vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { content: string }[] };
    const prompt = body.messages[0].content;
    sent.push(prompt);
    let out: unknown;
    if (prompt.includes("Phase 1")) out = { summary: "Talks about late rains.", notes: ["Rain timing", "Food worries"] };
    else if (prompt.includes("Phase 2")) {
      const text = prompt.split(/Participant P\d+:\n/)[1] ?? "";
      const words = text.replace(/Q\d+\.[^\n]*\n/g, "").split(/\s+/).filter(Boolean);
      out = { codes: [{ label: "Changing rains", description: "Rain no longer reliable", quotes: [words.slice(0, 8).join(" "), "a sentence that nobody ever said at all"] }] };
    } else if (prompt.includes("Phase 3")) {
      const ids = [...prompt.matchAll(/^(C\d+) /gm)].map((m) => m[1]);
      out = { codes: [{ label: "Unreliable rainfall", definition: "Rains come late or stop early.", members: ids }] };
    } else if (prompt.includes("Phase 4")) out = { themes: [{ name: "Rain you can no longer trust", definition: "Planting decisions now feel like a gamble.", codes: ["K1"], subthemes: [] }] };
    else if (prompt.includes("Framework matrix")) out = { T1: "Plants later and worries about seed." };
    else out = "## Method\nReflexive thematic analysis.\n\n## Findings\n### Rain you can no longer trust\nMost participants said the rains were late.";
    return new Response(JSON.stringify({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] }), { status: 200 });
  });
}

describe("thematic analysis", () => {
  it("finds quotes only when they are really in the transcript", () => {
    const src = "Well, the rains used to come in April. Now we plant and wait.";
    expect(findQuote("the rains used to come in April", src)).toBe("the rains used to come in April.");
    expect(findQuote("“Now we plant and wait”", src)).toBe("Now we plant and wait.");
    expect(findQuote("the rains never came at all", src)).toBeNull();
    expect(findQuote("rains", src)).toBeNull(); // too short to be evidence
  });

  it("runs every phase on the sample study, drops invented quotes, and exports Word and CSV", async () => {
    const id = await createSampleStudy(db, owner);
    const { list } = await cases(db, owner, id);
    expect(list.length).toBeGreaterThan(3);
    await expect(runPhase(db, owner, id, "familiar")).rejects.toThrow(/research question/);
    await saveSetup(db, owner, id, "How do farmers experience changing rainfall?", "Northern Ghana");

    const sent: string[] = [];
    vi.stubGlobal("fetch", fakeClaude(sent));
    await expect(runPhase(db, owner, id, "codebook")).rejects.toThrow(/previous step/);

    for (const phase of ["familiar", "codes", "matrix"] as const) {
      if (phase === "matrix") {
        await runPhase(db, owner, id, "codebook");
        await runPhase(db, owner, id, "themes");
      }
      let r;
      let calls = 0;
      do {
        r = await runPhase(db, owner, id, phase);
        calls++;
      } while (!r.finished && calls < 20);
      expect(r.finished).toBe(true);
      expect(r.done).toBe(list.length);
      expect(calls).toBeGreaterThan(1); // batched, so the page can show progress
    }
    await runPhase(db, owner, id, "report");

    const { state } = await getAnalysis(db, id);
    expect(Object.keys(state.familiar!)).toHaveLength(list.length);
    // every code keeps the real quote and loses the invented one
    for (const codes of Object.values(state.codes!)) for (const k of codes) for (const q of k.quotes) expect(q).not.toContain("nobody ever said");
    expect(state.codebook).toHaveLength(1);
    expect(state.codebook![0].rids).toHaveLength(list.length);
    expect(state.themes![0]).toMatchObject({ id: "T1", codes: ["K1"] });
    expect(state.matrix![list[0].rid].T1).toContain("Plants later");
    expect(state.report).toContain("## Findings");
    expect(Object.keys(state.done!)).toHaveLength(6);
    // names never go to the AI
    expect(sent.join("\n")).not.toMatch(/Kofi|@/);

    const s = (await getStudy(db, owner, id))!;
    const doc = await analysisExport(db, s, "report");
    expect(doc!.name).toBe("thematic-analysis.docx");
    expect(Buffer.from(doc!.body as Uint8Array).subarray(0, 2).toString()).toBe("PK");
    const book = await analysisExport(db, s, "codebook");
    expect(String(book!.body)).toContain("Unreliable rainfall");
    expect(String((await analysisExport(db, s, "matrix"))!.body)).toContain("Rain you can no longer trust");
  });

  it("continues a reply that hit the length limit instead of cutting it off", async () => {
    const id = await createSampleStudy(db, owner);
    await saveSetup(db, owner, id, "How do farmers experience changing rainfall?", "");
    const base = fakeClaude([]);
    let r;
    vi.stubGlobal("fetch", base);
    do r = await runPhase(db, owner, id, "codes");
    while (!r.finished);
    await runPhase(db, owner, id, "codebook");
    await runPhase(db, owner, id, "themes");
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
      bodies.push(init.body);
      const cont = body.messages.length > 1;
      const text = cont ? " and the harvest failed." : "### Rain you can no longer trust\nThe rains came late";
      return new Response(JSON.stringify({ content: [{ type: "text", text }], stop_reason: cont ? "end_turn" : "max_tokens" }), { status: 200 });
    }));
    await runPhase(db, owner, id, "report");
    const { state } = await getAnalysis(db, id);
    expect(state.report).toContain("The rains came late and the harvest failed.");
    expect(bodies.some((b) => b.includes("You were cut off"))).toBe(true);
  });

  it("lets the researcher rename and remove, and redoing a step clears the later ones", async () => {
    const id = await createSampleStudy(db, owner);
    await saveSetup(db, owner, id, "How do farmers experience changing rainfall?", "");
    vi.stubGlobal("fetch", fakeClaude([]));
    let r;
    do r = await runPhase(db, owner, id, "codes");
    while (!r.finished);
    await runPhase(db, owner, id, "codebook");
    await runPhase(db, owner, id, "themes");

    await editAnalysis(db, owner, id, { kind: "theme", id: "T1", name: "Gambling on the rains" });
    await editAnalysis(db, owner, id, { kind: "code", id: "K1", label: "Late rains" });
    let { state } = await getAnalysis(db, id);
    expect(state.themes![0].name).toBe("Gambling on the rains");
    expect(state.codebook![0].label).toBe("Late rains");

    await editAnalysis(db, owner, id, { kind: "code", id: "K1", remove: true });
    ({ state } = await getAnalysis(db, id));
    expect(state.themes![0].codes).toEqual([]);

    await runPhase(db, owner, id, "codebook", { restart: true });
    ({ state } = await getAnalysis(db, id));
    expect(state.themes).toBeUndefined();
    expect(state.done!.themes).toBeUndefined();
    expect(state.codebook).toHaveLength(1);

    const [other] = await db.insert(schema.users).values({ email: "x@example.com" }).returning();
    await expect(editAnalysis(db, other.id, id, { kind: "report", text: "hijack" })).rejects.toThrow(/not found/);
  });
});
