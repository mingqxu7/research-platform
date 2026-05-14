/**
 * Calibration scoring — pure functions for temperature variance matching.
 *
 * Extracted from the calibration route so the ranking logic can be unit tested
 * independently of the HTTP layer and database.
 */

export interface QuestionStats {
  mean: number;
  sd: number;
  se: number;
  n: number;
}

export interface TemperatureResult {
  temperature: number;
  question_stats: Record<string, QuestionStats>;
}

export interface RankedTemperature extends TemperatureResult {
  divergence_from_human_sd: number | null;
}

/**
 * Rank calibration temperatures by mean absolute divergence of AI response SD
 * from human reference SDs.
 *
 * When human_reference_sds is empty, divergence is null for all entries and
 * the input order is preserved — the caller must choose a temperature manually.
 *
 * Algorithm: for each temperature, compute |AI_sd - human_sd| per question
 * that has a reference, then average across questions (equal weighting).
 * Lower divergence = better variance match to human baseline.
 */
export function rankTemperaturesByVarianceMatch(
  results: TemperatureResult[],
  human_reference_sds: Record<string, number>,
): RankedTemperature[] {
  const hasRefs = Object.keys(human_reference_sds).length > 0;

  const ranked: RankedTemperature[] = results.map((r) => {
    let divergenceScore: number | null = null;

    if (hasRefs) {
      const divergences = Object.entries(r.question_stats)
        .filter(([qid]) => human_reference_sds[qid] !== undefined)
        .map(([qid, s]) => Math.abs(s.sd - human_reference_sds[qid]));

      if (divergences.length > 0) {
        divergenceScore = divergences.reduce((a, b) => a + b, 0) / divergences.length;
      }
    }

    return { ...r, divergence_from_human_sd: divergenceScore };
  });

  // Null divergences (no human reference) sort to the end so they are never
  // mistakenly selected as the best temperature.
  ranked.sort((a, b) => {
    if (a.divergence_from_human_sd === null && b.divergence_from_human_sd === null) return 0;
    if (a.divergence_from_human_sd === null) return 1;
    if (b.divergence_from_human_sd === null) return -1;
    return a.divergence_from_human_sd - b.divergence_from_human_sd;
  });

  return ranked;
}

/**
 * Return the temperature with the lowest SD divergence from human reference.
 * Returns null if no results or no human reference SDs provided.
 */
export function recommendTemperature(
  results: TemperatureResult[],
  human_reference_sds: Record<string, number>,
): number | null {
  if (results.length === 0) return null;
  const ranked = rankTemperaturesByVarianceMatch(results, human_reference_sds);
  const best = ranked[0];
  if (best.divergence_from_human_sd === null) return null;
  return best.temperature;
}
