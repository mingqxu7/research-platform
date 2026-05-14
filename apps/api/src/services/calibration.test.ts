import { describe, it, expect } from "vitest";
import { rankTemperaturesByVarianceMatch, recommendTemperature } from "./calibration";
import type { TemperatureResult } from "./calibration";

// Helpers
function makeResult(temp: number, sdByQ: Record<string, number>): TemperatureResult {
  const question_stats: TemperatureResult["question_stats"] = {};
  for (const [qid, sd] of Object.entries(sdByQ)) {
    question_stats[qid] = { mean: 4.0, sd, se: sd / Math.sqrt(30), n: 30 };
  }
  return { temperature: temp, question_stats };
}

// ─── rankTemperaturesByVarianceMatch ────────────────────────────────────────

describe("rankTemperaturesByVarianceMatch", () => {
  it("returns empty array for empty input", () => {
    expect(rankTemperaturesByVarianceMatch([], { q1: 1.2 })).toEqual([]);
  });

  it("sets divergence to null when no human reference SDs provided", () => {
    const results = [makeResult(0.5, { q1: 1.2 }), makeResult(1.0, { q1: 0.8 })];
    const ranked = rankTemperaturesByVarianceMatch(results, {});
    expect(ranked.every((r) => r.divergence_from_human_sd === null)).toBe(true);
  });

  it("preserves input order when all divergences are null", () => {
    const results = [makeResult(0.7, { q1: 1.0 }), makeResult(0.3, { q1: 1.5 })];
    const ranked = rankTemperaturesByVarianceMatch(results, {});
    expect(ranked.map((r) => r.temperature)).toEqual([0.7, 0.3]);
  });

  it("computes zero divergence when AI SD exactly matches human SD", () => {
    const results = [makeResult(0.5, { q1: 1.5, q2: 0.8 })];
    const ranked = rankTemperaturesByVarianceMatch(results, { q1: 1.5, q2: 0.8 });
    expect(ranked[0].divergence_from_human_sd).toBeCloseTo(0, 10);
  });

  it("computes MAD correctly for a single question", () => {
    // AI SD = 1.0, human SD = 1.4 → divergence = |1.0 - 1.4| = 0.4
    const results = [makeResult(0.5, { q1: 1.0 })];
    const ranked = rankTemperaturesByVarianceMatch(results, { q1: 1.4 });
    expect(ranked[0].divergence_from_human_sd).toBeCloseTo(0.4, 6);
  });

  it("averages divergence across multiple questions (equal weight)", () => {
    // q1: |1.0 - 1.2| = 0.2, q2: |1.5 - 1.0| = 0.5 → mean = 0.35
    const results = [makeResult(0.5, { q1: 1.0, q2: 1.5 })];
    const ranked = rankTemperaturesByVarianceMatch(results, { q1: 1.2, q2: 1.0 });
    expect(ranked[0].divergence_from_human_sd).toBeCloseTo(0.35, 6);
  });

  it("ignores questions with no matching human reference", () => {
    // Only q1 has a reference; q2 is ignored
    // q1: |1.0 - 1.4| = 0.4
    const results = [makeResult(0.5, { q1: 1.0, q2: 0.5 })];
    const ranked = rankTemperaturesByVarianceMatch(results, { q1: 1.4 });
    expect(ranked[0].divergence_from_human_sd).toBeCloseTo(0.4, 6);
  });

  it("sets divergence to null when no questions match the reference", () => {
    const results = [makeResult(0.5, { q1: 1.0 })];
    const ranked = rankTemperaturesByVarianceMatch(results, { q_other: 1.2 });
    expect(ranked[0].divergence_from_human_sd).toBeNull();
  });

  it("ranks lower divergence first", () => {
    // temp=0.3: |1.0 - 1.2| = 0.2 (better)
    // temp=1.0: |1.8 - 1.2| = 0.6 (worse)
    const results = [makeResult(1.0, { q1: 1.8 }), makeResult(0.3, { q1: 1.0 })];
    const ranked = rankTemperaturesByVarianceMatch(results, { q1: 1.2 });
    expect(ranked[0].temperature).toBe(0.3);
    expect(ranked[1].temperature).toBe(1.0);
  });

  it("handles three temperatures and selects the best match", () => {
    // human SD = 1.2
    // temp=0.3: AI SD = 0.7 → div = 0.5
    // temp=0.7: AI SD = 1.1 → div = 0.1 (best)
    // temp=1.0: AI SD = 1.6 → div = 0.4
    const results = [
      makeResult(0.3, { q1: 0.7 }),
      makeResult(0.7, { q1: 1.1 }),
      makeResult(1.0, { q1: 1.6 }),
    ];
    const ranked = rankTemperaturesByVarianceMatch(results, { q1: 1.2 });
    expect(ranked[0].temperature).toBe(0.7);
    expect(ranked[0].divergence_from_human_sd).toBeCloseTo(0.1, 6);
    expect(ranked[2].temperature).toBe(0.3);
  });

  it("all temperatures with null divergence maintain stable order", () => {
    const results = [makeResult(0.3, { q1: 1.0 }), makeResult(0.7, { q1: 1.5 }), makeResult(1.0, { q1: 2.0 })];
    const ranked = rankTemperaturesByVarianceMatch(results, {});
    expect(ranked.map((r) => r.temperature)).toEqual([0.3, 0.7, 1.0]);
  });
});

// ─── recommendTemperature ───────────────────────────────────────────────────

describe("recommendTemperature", () => {
  it("returns null for empty results", () => {
    expect(recommendTemperature([], { q1: 1.2 })).toBeNull();
  });

  it("returns null when no human reference provided", () => {
    const results = [makeResult(0.5, { q1: 1.2 })];
    expect(recommendTemperature(results, {})).toBeNull();
  });

  it("returns null when no questions match the reference", () => {
    const results = [makeResult(0.5, { q1: 1.0 })];
    expect(recommendTemperature(results, { q_other: 1.2 })).toBeNull();
  });

  it("returns the single temperature when only one result", () => {
    const results = [makeResult(0.5, { q1: 1.2 })];
    expect(recommendTemperature(results, { q1: 1.0 })).toBe(0.5);
  });

  it("returns the best-matching temperature", () => {
    const results = [makeResult(0.3, { q1: 0.6 }), makeResult(0.7, { q1: 1.2 }), makeResult(1.0, { q1: 1.8 })];
    // human SD = 1.2 → temp=0.7 is perfect match
    expect(recommendTemperature(results, { q1: 1.2 })).toBe(0.7);
  });

  it("handles tie in divergence — returns the first encountered", () => {
    // Both temp=0.3 and temp=1.0 have divergence 0.2 from human SD 1.0
    const results = [makeResult(0.3, { q1: 0.8 }), makeResult(1.0, { q1: 1.2 })];
    const rec = recommendTemperature(results, { q1: 1.0 });
    expect([0.3, 1.0]).toContain(rec);
  });

  it("multi-question: returns temperature with lowest mean absolute divergence", () => {
    // human: q1=1.2, q2=0.9
    // temp=0.5: q1=1.0 (Δ=0.2), q2=0.7 (Δ=0.2) → mean=0.20
    // temp=1.0: q1=1.3 (Δ=0.1), q2=1.4 (Δ=0.5) → mean=0.30
    const results = [
      makeResult(0.5, { q1: 1.0, q2: 0.7 }),
      makeResult(1.0, { q1: 1.3, q2: 1.4 }),
    ];
    expect(recommendTemperature(results, { q1: 1.2, q2: 0.9 })).toBe(0.5);
  });
});
