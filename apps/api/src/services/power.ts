/**
 * Pure computation helpers for the power analysis route.
 * Extracted so they can be unit-tested without HTTP or a live analysis service.
 */

export interface PowerDispatch {
  test_type: "welch_t" | "welch_anova";
  /** Effect size in the unit expected by the analysis service for the chosen test. */
  effect_size: number;
  corrected_alpha: number;
}

/**
 * Map user-facing power inputs to the analysis service payload.
 *
 * Effect-size unit rules:
 *   - welch_t expects Cohen's d
 *   - welch_anova expects Cohen's f
 *
 * User may supply either metric; convert when they don't match:
 *   d = 2f  (2-group)
 *   f = d/2 (3+ groups, approximation for balanced designs)
 *
 * Alpha correction: Bonferroni per DV (alpha / num_dvs).
 */
export function buildPowerDispatch(params: {
  effect_size: number;
  effect_metric: "cohens_d" | "cohens_f";
  alpha: number;
  num_conditions: number;
  num_dvs: number;
}): PowerDispatch {
  const { effect_size, effect_metric, alpha, num_conditions, num_dvs } = params;
  if (num_dvs <= 0) throw new Error("num_dvs must be >= 1");
  if (effect_size <= 0) throw new Error("effect_size must be > 0");
  const corrected_alpha = alpha / num_dvs;

  if (num_conditions === 2) {
    return {
      test_type: "welch_t",
      effect_size: effect_metric === "cohens_f" ? effect_size * 2 : effect_size,
      corrected_alpha,
    };
  } else {
    return {
      test_type: "welch_anova",
      effect_size: effect_metric === "cohens_d" ? effect_size / 2 : effect_size,
      corrected_alpha,
    };
  }
}
