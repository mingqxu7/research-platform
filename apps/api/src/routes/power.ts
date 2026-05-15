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
import { buildPowerDispatch } from "../services/power";

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

    const { test_type, effect_size: fs_effect_size, corrected_alpha: correctedAlpha } =
      buildPowerDispatch({ effect_size, effect_metric, alpha, num_conditions, num_dvs });

    const analysisUrl =
      process.env.ANALYSIS_SERVICE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

    let upstream: Response;
    try {
      upstream = await fetch(`${analysisUrl}/power-analysis`, {
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
    } catch {
      return reply.status(502).send({ error: "Analysis service unavailable" });
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "unknown error");
      return reply.status(502).send({ error: "Analysis service error", detail });
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
