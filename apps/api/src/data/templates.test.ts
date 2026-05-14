import { describe, it, expect } from "vitest";
import { STUDY_TEMPLATES } from "./templates";

describe("STUDY_TEMPLATES data integrity", () => {
  it("contains exactly 5 templates", () => {
    expect(STUDY_TEMPLATES).toHaveLength(5);
  });

  it("all template ids are unique", () => {
    const ids = STUDY_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all templates have question_benchmarks", () => {
    for (const t of STUDY_TEMPLATES) {
      expect(
        t.question_benchmarks?.length,
        `${t.id} is missing question_benchmarks`,
      ).toBeGreaterThan(0);
    }
  });

  it("all benchmark question_order_index values reference existing questions", () => {
    for (const t of STUDY_TEMPLATES) {
      const validIndices = new Set(t.questions.map((q) => q.order_index));
      for (const b of t.question_benchmarks ?? []) {
        expect(
          validIndices.has(b.question_order_index),
          `${t.id}: benchmark question_order_index ${b.question_order_index} has no matching question`,
        ).toBe(true);
      }
    }
  });

  it("no duplicate question_order_index within a template's benchmarks", () => {
    for (const t of STUDY_TEMPLATES) {
      const seen = new Set<number>();
      for (const b of t.question_benchmarks ?? []) {
        expect(
          seen.has(b.question_order_index),
          `${t.id}: duplicate benchmark for question_order_index ${b.question_order_index}`,
        ).toBe(false);
        seen.add(b.question_order_index);
      }
    }
  });

  it("all benchmarks have required fields with valid values", () => {
    for (const t of STUDY_TEMPLATES) {
      for (const b of t.question_benchmarks ?? []) {
        expect(typeof b.finding_label).toBe("string");
        expect(b.finding_label.length).toBeGreaterThan(0);
        expect(typeof b.effect_size).toBe("number");
        expect(isFinite(b.effect_size)).toBe(true);
        expect(typeof b.effect_size_type).toBe("string");
        if (b.ci_lower !== undefined && b.ci_upper !== undefined) {
          expect(b.ci_lower).toBeLessThan(b.ci_upper);
        }
      }
    }
  });

  it("questions have contiguous zero-based order_index values", () => {
    for (const t of STUDY_TEMPLATES) {
      const indices = t.questions.map((q) => q.order_index).sort((a, b) => a - b);
      indices.forEach((idx, i) => {
        expect(idx).toBe(i);
      });
    }
  });

  it("conditions have contiguous zero-based order_index values", () => {
    for (const t of STUDY_TEMPLATES) {
      const indices = t.conditions.map((c) => c.order_index).sort((a, b) => a - b);
      indices.forEach((idx, i) => {
        expect(idx).toBe(i);
      });
    }
  });

  it("has_benchmarks flag matches actual benchmark presence", () => {
    for (const t of STUDY_TEMPLATES) {
      const hasBenchmarks = (t.question_benchmarks?.length ?? 0) > 0;
      expect(hasBenchmarks).toBe(true);
    }
  });
});
