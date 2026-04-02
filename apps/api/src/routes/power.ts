/**
 * Power Analysis / N Recommendation Tool
 *
 * Given expected effect size, desired power, and alpha, returns
 * minimum recommended N for a between-subjects study.
 *
 * Formula: Welch's t-test approximate power for 2-group comparison.
 * For more groups: one-way ANOVA approximation.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

const PowerQuerySchema = z.object({
  effect_size: z.number().positive(), // Cohen's d or f
  effect_metric: z.enum(["cohens_d", "cohens_f"]).default("cohens_d"),
  power: z.number().min(0.7).max(0.99).default(0.8),
  alpha: z.number().min(0.001).max(0.1).default(0.05),
  num_conditions: z.number().int().min(2).default(2),
  num_dvs: z.number().int().min(1).default(1),
});

// Normal distribution CDF approximation (rational approximation)
function normCdf(x: number): number {
  const a = 0.2316419;
  const b = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
  const t = 1 / (1 + a * Math.abs(x));
  const poly = t * (b[0] + t * (b[1] + t * (b[2] + t * (b[3] + t * b[4]))));
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

function normInv(p: number): number {
  // Beasley-Springer-Moro approximation
  const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
  const b = [-8.4735109309, 23.08336743743, -21.06224101826, 3.13082909833];
  const c = [
    0.3374754822726147, 0.9761690190917186, 0.1607979714918209, 0.0276438810333863,
    0.0038405729373609, 0.0003951896511349, 0.0000321767881768, 0.0000002888167364,
    0.0000003960315187,
  ];
  const y = p - 0.5;
  if (Math.abs(y) < 0.42) {
    const r = y * y;
    return (
      (y * (((a[3] * r + a[2]) * r + a[1]) * r + a[0])) /
      ((((b[3] * r + b[2]) * r + b[1]) * r + b[0]) * r + 1)
    );
  }
  const r = Math.log(-Math.log(y < 0 ? p : 1 - p));
  return (y < 0 ? -1 : 1) * (c[0] + r * (c[1] + r * (c[2] + r * (c[3] + r * (c[4] + r * (c[5] + r * (c[6] + r * (c[7] + r * c[8]))))))));
}

/** Minimum N per group for Welch's t-test (2 groups, Cohen's d) */
function nForTTest(d: number, power: number, alpha: number): number {
  const zAlpha = normInv(1 - alpha / 2);
  const zBeta = normInv(power);
  // n per group = 2 * ((z_alpha + z_beta) / d)^2
  const n = 2 * Math.pow((zAlpha + zBeta) / d, 2);
  return Math.ceil(n);
}

/** Min N per group for one-way ANOVA (k groups, Cohen's f) */
function nForAnova(f: number, power: number, alpha: number, k: number): number {
  // Approximation: total N = k * n_per_group
  // Using f → d conversion for approximate power: d ≈ 2f
  const dApprox = 2 * f;
  const nPerGroup = nForTTest(dApprox, power, alpha);
  return nPerGroup;
}

export async function powerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/power/recommend", async (req, reply) => {
    const params = PowerQuerySchema.parse(req.query);
    const { effect_size, effect_metric, power, alpha, num_conditions, num_dvs } = params;

    // Correct alpha for multiple DVs (Bonferroni)
    const correctedAlpha = alpha / num_dvs;

    let nPerGroup: number;
    let method: string;

    if (num_conditions === 2) {
      const d = effect_metric === "cohens_f" ? effect_size * 2 : effect_size;
      nPerGroup = nForTTest(d, power, correctedAlpha);
      method = "Welch's t-test";
    } else {
      const f = effect_metric === "cohens_d" ? effect_size / 2 : effect_size;
      nPerGroup = nForAnova(f, power, correctedAlpha, num_conditions);
      method = "One-way ANOVA";
    }

    const totalN = nPerGroup * num_conditions;

    // AI persona note: LLMs typically show lower within-group variance
    // than human panels, so smaller N may reach significance faster.
    // But this can overstate effect sizes vs. human populations.
    const aiAdjustedNote =
      "AI personas typically show lower within-group variance than human panels. " +
      "This means your study may be powered at smaller N than shown — " +
      "but narrower AI variance can also overstate effect sizes relative to human populations. " +
      "We recommend not reducing N below the calculated value for your first study.";

    return {
      n_per_group: nPerGroup,
      total_n: totalN,
      method,
      inputs: {
        effect_size,
        effect_metric,
        power,
        alpha_raw: alpha,
        alpha_corrected: correctedAlpha,
        num_conditions,
        num_dvs,
      },
      ai_persona_note: aiAdjustedNote,
    };
  });
}
