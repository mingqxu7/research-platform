/**
 * Calibration Runner — Bull queue for temperature calibration jobs
 *
 * Each job is one persona API call at a specific temperature.
 * After all calls for a calibration_run_id complete, compute per-temperature
 * variance stats and write to calibration_results.
 */

import { Queue, Worker, type Job } from "bullmq";
import { db } from "../db/client";
import { runPersonaSurvey } from "../services/llm";
import type { Condition, Question } from "../db/types";

const QUEUE_NAME = "calibration-survey";
const MAX_CONCURRENCY = 30;

const redisConnection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const calibrationQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

export interface CalibrationJobData {
  calibration_run_id: string;
  calibration_persona_id: string;
  study_id: string;
  condition_id: string;
  temperature: number;
  model: string;
  persona_text: string;
  study_context?: string;
}

export function startCalibrationWorker(): Worker {
  return new Worker<CalibrationJobData>(
    QUEUE_NAME,
    async (job: Job<CalibrationJobData>) => {
      const {
        calibration_run_id,
        calibration_persona_id,
        study_id,
        condition_id,
        temperature,
        model,
        persona_text,
        study_context,
      } = job.data;

      const [questions, condition] = await Promise.all([
        db<Question>("questions").where({ study_id, is_open_ended: false }).orderBy("order_index"),
        db<Condition>("conditions").where({ id: condition_id }).first(),
      ]);

      const result = await runPersonaSurvey({
        persona_text,
        study_context,
        stimulus_text: condition?.stimulus_text ?? undefined,
        questions,
        model,
        temperature,
      });

      // Persist calibration responses
      const responseRows = questions
        .filter((q) => !q.is_open_ended)
        .map((q) => {
          const answer = result.answers.find((a) => a.question_id === q.id);
          const parsedValue = answer?.value !== undefined && answer?.value !== null
            ? Number(answer.value)
            : null;

          return {
            calibration_run_id,
            calibration_persona_id,
            question_id: q.id,
            temperature,
            parsed_value: Number.isNaN(parsedValue ?? NaN) ? null : parsedValue,
            parse_status: result.parse_status,
          };
        });

      if (responseRows.length > 0) {
        await db("calibration_responses").insert(responseRows);
      }

      // Check if this calibration run is now complete
      await checkCalibrationCompletion(calibration_run_id);
    },
    { connection: redisConnection, concurrency: MAX_CONCURRENCY },
  );
}

export async function enqueueCalibrationRun(calibRunId: string): Promise<void> {
  const calibRun = await db("calibration_runs").where({ id: calibRunId }).first();
  if (!calibRun) throw new Error(`Calibration run ${calibRunId} not found`);

  const study = await db("studies").where({ id: calibRun.study_id }).first();
  const personas = await db("calibration_personas").where({ calibration_run_id: calibRunId });

  const jobs = personas.map((p) => ({
    name: `calib-${p.id}`,
    data: {
      calibration_run_id: calibRunId,
      calibration_persona_id: p.id,
      study_id: calibRun.study_id,
      condition_id: p.condition_id,
      temperature: p.calibration_temperature,
      model: study?.model_version ?? "claude-sonnet-4-6",
      persona_text: p.persona_text,
      study_context: study?.study_context ?? undefined,
    } satisfies CalibrationJobData,
  }));

  await calibrationQueue.addBulk(jobs);
}

async function checkCalibrationCompletion(calibRunId: string): Promise<void> {
  const calibRun = await db("calibration_runs").where({ id: calibRunId }).first();
  if (!calibRun) return;

  const [totalResult, completedResult] = await Promise.all([
    db("calibration_personas").where({ calibration_run_id: calibRunId }).count("id as cnt").first(),
    db("calibration_responses")
      .where({ calibration_run_id: calibRunId })
      .countDistinct("calibration_persona_id as cnt")
      .first(),
  ]);

  const total = Number((totalResult as { cnt: string })?.cnt ?? 0);
  const completed = Number((completedResult as { cnt: string })?.cnt ?? 0);

  if (completed < total) return;

  // Conditional update: only the worker that wins this CAS-like update computes stats.
  // Without this guard, all ~30 concurrent workers could race into the stat-computation
  // block, inserting duplicate calibration_results rows per temperature.
  const updatedCount = await db("calibration_runs")
    .where({ id: calibRunId, status: "running" })
    .update({ status: "complete", completed_at: new Date() });

  if (updatedCount === 0) return;

  // All done — compute per-temperature variance stats
  const questions = await db("questions")
    .where({ study_id: calibRun.study_id, is_open_ended: false });

  const temperatures: number[] = calibRun.temperatures as number[];

  for (const temp of temperatures) {
    const responses = await db("calibration_responses")
      .where({ calibration_run_id: calibRunId, temperature: temp, parse_status: "ok" })
      .whereNotNull("parsed_value");

    const statsByQuestion: Record<string, { mean: number; sd: number; se: number; n: number }> = {};

    for (const q of questions) {
      const vals = responses
        .filter((r) => r.question_id === q.id)
        .map((r) => Number(r.parsed_value));

      if (vals.length < 2) continue;

      const n = vals.length;
      const mean = vals.reduce((a, b) => a + b, 0) / n;
      const variance = vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
      const sd = Math.sqrt(variance);
      const se = sd / Math.sqrt(n);

      statsByQuestion[q.id] = { mean, sd, se, n };
    }

    await db("calibration_results").insert({
      calibration_run_id: calibRunId,
      temperature: temp,
      question_stats: statsByQuestion,
    });
  }
}
