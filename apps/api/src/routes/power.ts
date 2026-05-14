/**
 * Power Analysis / N Recommendation Tool
 *
 * Proxies to the Python analysis service which uses statsmodels non-central
 * distributions (G*Power-validated). The prior hand-rolled Gaussian
 * approximation was accurate for t-tests (+/-1) but overestimated ANOVA
 * sample size by ~21% (63 vs 52 per group for f=0.25, k=3).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

const PowerQuerySchema = z.object({
  effect_size: z.number().positive(),
  effect_metric: z.enum(["cohens_d", "cohens_f"]).default("cohens_d"),
  power: z.number().min(0.7).max(0.99).default(0.8),
  alpha: z.number().min(0.001).max(0.1).default(0.05),
  num_conditions: z.number().int().min(2).default(2),
  num_dvs: z.number().int().min(1).default(1),
});

const AI_PERSONA_NOTE =
  "AI personas typically show lower within-group variance than human panels. " +
  "This means your study may be powered at smaller N than shown — " +
  "but narrower AI variance can also overstate effect sizes relative to human populations. " +
  "We recommend not reducing N below the calculated value for your first study.";

export async function powerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/power/recommend", async (req, reply) => {
    const params = PowerQuerySchema.parse(req.query);
    const { effect_size, effect_metric, power, alpha, num_conditions, num_dvs } = params;

    // Bonferroni correction for multiple dependent variables
    const correctedAlpha = alpha / num_dvs;

    // Map frontend effect_metric + num_conditions → analysis service test_type and effect size.
    // cohens_d with >2 groups converts to cohens_f (f = d/2) for ANOVA.
    let test_type: string;
    let fs_effect_size: number;

    if (num_conditions === 2) {
      test_type = "welch_t";
      // cohens_f → cohens_d conversion for 2-group case (d = 2f)
      fs_effect_size = effect_metric === "cohens_f" ? effect_size * 2 : effect_size;
    } else {
      test_type = "welch_anova";
      // cohens_d → cohens_f conversion for ANOVA (f = d/2)
      fs_effect_size = effect_metric === "cohens_d" ? effect_size / 2 : effect_size;
    }

    const analysisUrl =
      process.env.ANALYSIS_SERVICE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

    const upstream = await fetch(`${analysisUrl}/power-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        test_type,
        effect_size: fs_effect_size,
        alpha: correctedAlpha,
        power,
        n_groups: num_conditions,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "unknown error");
      reply.status(502).send({ error: "Analysis service error", detail });
      return;
    }

    const result = await upstream.json() as {
      n_per_group: number;
      power: number;
      effect_size_label: string;
      notes: string;
    };

    return {
      n_per_group: result.n_per_group,
      total_n: result.n_per_group * num_conditions,
      method: num_conditions === 2 ? "Welch's t-test" : "Welch's one-way ANOVA",
      inputs: {
        effect_size,
        effect_metric,
        power,
        alpha_raw: alpha,
        alpha_corrected: correctedAlpha,
        num_conditions,
        num_dvs,
      },
      ai_persona_note: AI_PERSONA_NOTE,
    };
  });
}
