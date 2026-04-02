/**
 * Temperature Calibration Routes
 *
 * Implements the empirical calibration protocol from spec Section 7.2.
 *
 * Process:
 *   1. User creates a calibration job for a study, specifying a set of
 *      temperatures to test (default: [0.3, 0.5, 0.7, 1.0]) and N per temp.
 *   2. The API generates a small persona cohort at each temperature and
 *      runs them against the study's questions (same conditions, same N).
 *   3. Each temp's response distribution is captured as: mean, sd, se.
 *   4. The caller (or the UI) can then view per-temperature variance metrics
 *      and optionally upload a human reference sd to find the best match.
 *   5. User picks a temperature; the study's temperature field is locked.
 *
 * The calibration run is a lightweight version of a full experiment run —
 * it uses BullMQ but at a smaller scale (typically N=20-50 per temperature).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { sampleDemographics, buildPersonaText } from "../services/persona-generator";
import { enqueueCalibrationRun } from "../queue/calibration-runner";
import type { DemographicSpec } from "../db/types";

const StartCalibrationSchema = z.object({
  temperatures: z.array(z.number().min(0).max(2)).min(1).max(8).default([0.3, 0.5, 0.7, 1.0]),
  n_per_temperature: z.number().int().min(10).max(200).default(30),
  // Optional: human reference standard deviation per question (for auto-ranking)
  human_reference_sds: z.record(z.number()).optional(),
});

const LockTemperatureSchema = z.object({
  temperature: z.number().min(0).max(2),
});

export async function calibrationRoutes(app: FastifyInstance): Promise<void> {
  // Start a calibration run for a study
  app.post<{ Params: { id: string } }>(
    "/studies/:id/calibration",
    async (req, reply) => {
      const study = await db("studies").where({ id: req.params.id }).first();
      if (!study) return reply.code(404).send({ error: "Study not found" });

      const conditions = await db("conditions").where({ study_id: study.id });
      if (conditions.length < 2) {
        return reply.code(422).send({
          error: "At least 2 conditions required before calibration.",
        });
      }

      const questions = await db("questions")
        .where({ study_id: study.id, is_open_ended: false });
      if (questions.length === 0) {
        return reply.code(422).send({
          error: "At least one non-open-ended question required before calibration.",
        });
      }

      const body = StartCalibrationSchema.parse(req.body);

      // Create calibration record
      const [calib] = await db("calibration_runs")
        .insert({
          study_id: study.id,
          temperatures: JSON.stringify(body.temperatures),
          n_per_temperature: body.n_per_temperature,
          human_reference_sds: body.human_reference_sds
            ? JSON.stringify(body.human_reference_sds)
            : null,
          status: "running",
        })
        .returning("*");

      // Generate calibration personas across all temperatures
      const personaRows: Array<{
        study_id: string;
        condition_id: string;
        persona_text: string;
        demographics: DemographicSpec;
        persona_index: number;
        calibration_run_id: string;
        calibration_temperature: number;
      }> = [];

      for (const temp of body.temperatures) {
        for (let i = 0; i < body.n_per_temperature; i++) {
          const condition = conditions[i % conditions.length];
          const demographics = sampleDemographics(study.demographic_spec as DemographicSpec);
          const personaText = buildPersonaText(demographics);

          personaRows.push({
            study_id: study.id,
            condition_id: condition.id,
            persona_text: personaText,
            demographics: demographics as unknown as DemographicSpec,
            persona_index: i + 1,
            calibration_run_id: calib.id,
            calibration_temperature: temp,
          });
        }
      }

      for (let i = 0; i < personaRows.length; i += 500) {
        await db("calibration_personas").insert(personaRows.slice(i, i + 500));
      }

      await enqueueCalibrationRun(calib.id);

      return reply.code(202).send({
        calibration_run_id: calib.id,
        status: "running",
        temperatures: body.temperatures,
        n_per_temperature: body.n_per_temperature,
        total_calls: body.temperatures.length * body.n_per_temperature,
        message: `Running ${body.temperatures.length} temperature variants × ${body.n_per_temperature} personas each.`,
      });
    },
  );

  // Get calibration run status and results
  app.get<{ Params: { id: string; calibId: string } }>(
    "/studies/:id/calibration/:calibId",
    async (req, reply) => {
      const calib = await db("calibration_runs")
        .where({ id: req.params.calibId, study_id: req.params.id })
        .first();
      if (!calib) return reply.code(404).send({ error: "Calibration run not found" });

      if (calib.status !== "complete") {
        const completed = await db("calibration_responses")
          .where({ calibration_run_id: calib.id })
          .countDistinct("calibration_persona_id as cnt")
          .first();
        return {
          ...calib,
          completed_calls: Number((completed as { cnt: string })?.cnt ?? 0),
        };
      }

      // Return per-temperature variance summary
      const results = await db("calibration_results")
        .where({ calibration_run_id: calib.id })
        .orderBy("temperature");

      const humanSds: Record<string, number> = calib.human_reference_sds
        ? JSON.parse(calib.human_reference_sds)
        : {};

      // Rank temperatures by mean absolute divergence from human SDs
      const ranked = results.map((r) => {
        const stats: Record<string, { mean: number; sd: number; se: number }> = JSON.parse(r.question_stats);
        let divergenceScore: number | null = null;

        if (Object.keys(humanSds).length > 0) {
          const divergences = Object.entries(stats)
            .filter(([qid]) => humanSds[qid] !== undefined)
            .map(([qid, s]) => Math.abs(s.sd - humanSds[qid]));
          if (divergences.length > 0) {
            divergenceScore = divergences.reduce((a, b) => a + b, 0) / divergences.length;
          }
        }

        return {
          temperature: r.temperature,
          question_stats: stats,
          divergence_from_human_sd: divergenceScore,
        };
      });

      ranked.sort((a, b) => {
        if (a.divergence_from_human_sd === null || b.divergence_from_human_sd === null) return 0;
        return a.divergence_from_human_sd - b.divergence_from_human_sd;
      });

      return {
        ...calib,
        temperature_results: ranked,
        recommended_temperature: ranked[0]?.temperature ?? null,
      };
    },
  );

  // List calibration runs for a study
  app.get<{ Params: { id: string } }>(
    "/studies/:id/calibration",
    async (req, reply) => {
      const study = await db("studies").where({ id: req.params.id }).first();
      if (!study) return reply.code(404).send({ error: "Study not found" });

      return db("calibration_runs")
        .where({ study_id: req.params.id })
        .orderBy("created_at", "desc");
    },
  );

  // Lock a temperature to the study (permanently sets study.temperature)
  app.post<{ Params: { id: string } }>(
    "/studies/:id/calibration/lock",
    async (req, reply) => {
      const study = await db("studies").where({ id: req.params.id }).first();
      if (!study) return reply.code(404).send({ error: "Study not found" });

      const { temperature } = LockTemperatureSchema.parse(req.body);

      const [updated] = await db("studies")
        .where({ id: req.params.id })
        .update({ temperature, updated_at: new Date() })
        .returning("*");

      return {
        study_id: req.params.id,
        temperature_locked: updated.temperature,
        message: `Temperature ${temperature} locked. Study is ready to launch.`,
      };
    },
  );
}
