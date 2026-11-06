import { describe, expect, it } from "vitest";
import { apaRound } from "@/server/statsAi";

describe("numbers handed to the interpreter", () => {
  it("are rounded the APA way so the model copies them", () => {
    expect(apaRound({ F: 8.6555, p: 0.00001, df: [4, 395], coefs: [{ b: -0.0096593, se: 0.0438587, p: 0.826 }], r2: 0.08059, t: -12.9469 })).toEqual({
      F: 8.66, p: "< .001", df: [4, 395], coefs: [{ b: -0.01, se: 0.044, p: ".826" }], r2: 0.08, t: -12.95,
    });
  });
});
