import { describe, it, expect } from "vitest";
import { buildPowerDispatch } from "./power";

describe("buildPowerDispatch", () => {
  // ─── test type routing ───────────────────────────────────────────────────

  it("routes 2 conditions to welch_t", () => {
    const r = buildPowerDispatch({ effect_size: 0.5, effect_metric: "cohens_d", alpha: 0.05, num_conditions: 2, num_dvs: 1 });
    expect(r.test_type).toBe("welch_t");
  });

  it("routes 3 conditions to welch_anova", () => {
    const r = buildPowerDispatch({ effect_size: 0.25, effect_metric: "cohens_f", alpha: 0.05, num_conditions: 3, num_dvs: 1 });
    expect(r.test_type).toBe("welch_anova");
  });

  it("routes 4 conditions to welch_anova", () => {
    const r = buildPowerDispatch({ effect_size: 0.25, effect_metric: "cohens_f", alpha: 0.05, num_conditions: 4, num_dvs: 1 });
    expect(r.test_type).toBe("welch_anova");
  });

  // ─── effect size conversion ──────────────────────────────────────────────

  it("2-group cohens_d: passes through unchanged", () => {
    const r = buildPowerDispatch({ effect_size: 0.5, effect_metric: "cohens_d", alpha: 0.05, num_conditions: 2, num_dvs: 1 });
    expect(r.effect_size).toBeCloseTo(0.5, 10);
  });

  it("2-group cohens_f: converts f → d (d = f * 2)", () => {
    const r = buildPowerDispatch({ effect_size: 0.25, effect_metric: "cohens_f", alpha: 0.05, num_conditions: 2, num_dvs: 1 });
    expect(r.effect_size).toBeCloseTo(0.5, 10);
  });

  it("3-group cohens_f: passes through unchanged", () => {
    const r = buildPowerDispatch({ effect_size: 0.25, effect_metric: "cohens_f", alpha: 0.05, num_conditions: 3, num_dvs: 1 });
    expect(r.effect_size).toBeCloseTo(0.25, 10);
  });

  it("3-group cohens_d: converts d → f (f = d / 2)", () => {
    const r = buildPowerDispatch({ effect_size: 0.5, effect_metric: "cohens_d", alpha: 0.05, num_conditions: 3, num_dvs: 1 });
    expect(r.effect_size).toBeCloseTo(0.25, 10);
  });

  // ─── Bonferroni alpha correction ─────────────────────────────────────────

  it("no correction when num_dvs = 1", () => {
    const r = buildPowerDispatch({ effect_size: 0.5, effect_metric: "cohens_d", alpha: 0.05, num_conditions: 2, num_dvs: 1 });
    expect(r.corrected_alpha).toBeCloseTo(0.05, 10);
  });

  it("divides alpha by num_dvs for Bonferroni correction", () => {
    const r = buildPowerDispatch({ effect_size: 0.5, effect_metric: "cohens_d", alpha: 0.05, num_conditions: 2, num_dvs: 5 });
    expect(r.corrected_alpha).toBeCloseTo(0.01, 10);
  });

  it("Bonferroni: alpha=0.05, num_dvs=10 → corrected=0.005", () => {
    const r = buildPowerDispatch({ effect_size: 0.3, effect_metric: "cohens_d", alpha: 0.05, num_conditions: 2, num_dvs: 10 });
    expect(r.corrected_alpha).toBeCloseTo(0.005, 10);
  });

  it("Bonferroni: alpha=0.01, num_dvs=4 → corrected=0.0025", () => {
    const r = buildPowerDispatch({ effect_size: 0.3, effect_metric: "cohens_d", alpha: 0.01, num_conditions: 2, num_dvs: 4 });
    expect(r.corrected_alpha).toBeCloseTo(0.0025, 10);
  });

  // ─── combined: typical study configurations ──────────────────────────────

  it("typical 2-condition marketing study (d=0.3, alpha=0.05, 5 DVs)", () => {
    const r = buildPowerDispatch({ effect_size: 0.3, effect_metric: "cohens_d", alpha: 0.05, num_conditions: 2, num_dvs: 5 });
    expect(r.test_type).toBe("welch_t");
    expect(r.effect_size).toBeCloseTo(0.3, 10);
    expect(r.corrected_alpha).toBeCloseTo(0.01, 10);
  });

  it("typical 3-condition ANOVA study (f=0.25, alpha=0.05, 3 DVs)", () => {
    const r = buildPowerDispatch({ effect_size: 0.25, effect_metric: "cohens_f", alpha: 0.05, num_conditions: 3, num_dvs: 3 });
    expect(r.test_type).toBe("welch_anova");
    expect(r.effect_size).toBeCloseTo(0.25, 10);
    expect(r.corrected_alpha).toBeCloseTo(0.05 / 3, 10);
  });
});
