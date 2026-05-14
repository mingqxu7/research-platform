/**
 * Experiment Runner — Bull/BullMQ job queue
 *
 * Manages parallel async execution of all persona API calls.
 * Contract:
 *   - Max 50 concurrent Claude calls per run (burst-safe)
 *   - Exponential backoff on 529/overload errors
 *   - Run lifecycle: queued → running → processing → complete | failed
 */

import { Queue, Worker, QueueEvents, type Job } from "bullmq";
import { db } from "../db/client";
import { runPersonaSurvey } from "../services/llm";
import type { Condition, Question } from "../db/types";

const QUEUE_NAME = "persona-survey";
const MAX_CONCURRENCY = 50;

const redisConnection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

export const surveyQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 2000, // start at 2s, doubles each retry
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

export interface PersonaJobData {
  run_id: string;
  persona_id: string;
  study_id: string;
  condition_id: string;
  model: string;
  temperature: number;
  persona_text: string;
  study_context?: string;
}

/** Worker — processes one persona survey job */
export function startWorker(): Worker {
  return new Worker<PersonaJobData>(
    QUEUE_NAME,
    async (job: Job<PersonaJobData>) => {
      const {
        run_id,
        persona_id,
        study_id,
        condition_id,
        model,
        temperature,
        persona_text,
        study_context,
      } = job.data;

      // Fetch questions and condition stimulus
      const [questions, condition] = await Promise.all([
        db<Question>("questions").where({ study_id }).orderBy("order_index"),
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

      // Persist all responses
      const responseRows = questions
        .filter((q) => !q.is_open_ended)
        .map((q) => {
          const answer = result.answers.find((a) => a.question_id === q.id);
          const rawValue = answer ? String(answer.value) : null;
          const parsedValue =
            answer?.value !== null && answer?.value !== undefined
              ? Number(answer.value)
              : null;

          return {
            run_id,
            persona_id,
            question_id: q.id,
            raw_value: rawValue,
            parsed_value: Number.isNaN(parsedValue ?? NaN) ? null : parsedValue,
            parse_status: result.parse_status,
            retry_count: 0,
            raw_llm_response: result.raw_response,
          };
        });

      if (responseRows.length > 0) {
        await db("responses").insert(responseRows);
      }

      // Update run progress counter
      await db("runs").where({ id: run_id }).increment("completed_personas", 1);

      if (result.parse_status !== "ok") {
        await db("runs").where({ id: run_id }).increment("failed_personas", 1);
      }

      // Track token usage
      await db("runs")
        .where({ id: run_id })
        .increment("tokens_used", result.tokens_used);

      // Check if this run is now complete and trigger analysis
      await checkRunCompletion(run_id);
    },
    {
      connection: redisConnection,
      concurrency: MAX_CONCURRENCY,
    },
  );
}

/** Enqueue all personas for a run */
export async function enqueueRun(runId: string): Promise<void> {
  const run = await db("runs").where({ id: runId }).first();
  if (!run) throw new Error(`Run ${runId} not found`);

  const study = await db("studies").where({ id: run.study_id }).first();
  if (!study) throw new Error(`Study ${run.study_id} not found`);

  const personas = await db("personas").where({ study_id: run.study_id });

  // Update run to running
  await db("runs")
    .where({ id: runId })
    .update({ status: "running", started_at: new Date() });

  const jobs = personas.map((persona) => ({
    name: `persona-${persona.id}`,
    data: {
      run_id: runId,
      persona_id: persona.id,
      study_id: run.study_id,
      condition_id: persona.condition_id,
      model: study.model_version,
      temperature: study.temperature ?? 0.7,
      persona_text: persona.persona_text,
      study_context: study.study_context ?? undefined,
    } satisfies PersonaJobData,
  }));

  await surveyQueue.addBulk(jobs);
}

/** Check if all jobs for a run are done, then trigger analysis */
export async function checkRunCompletion(runId: string): Promise<void> {
  const run = await db("runs").where({ id: runId }).first();
  if (!run) return;

  const allDone =
    run.completed_personas + run.failed_personas >= run.total_personas;

  if (allDone) {
    // Conditional update: only the worker that wins this CAS-like update triggers analysis.
    // Without this guard, all ~50 concurrent workers finishing around the same time would
    // each read status="running" and each call triggerAnalysis, causing N duplicate analyses.
    const updatedCount = await db("runs")
      .where({ id: runId, status: "running" })
      .update({ status: "processing", completed_at: new Date() });

    if (updatedCount > 0) {
      await triggerAnalysis(runId);
    }
  }
}

async function triggerAnalysis(runId: string): Promise<void> {
  const analysisUrl = process.env.ANALYSIS_SERVICE_URL ?? "http://localhost:8000";
  try {
    const response = await fetch(`${analysisUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId }),
    });
    if (!response.ok) {
      console.error(`Analysis service returned ${response.status} for run ${runId}`);
    }
  } catch (err) {
    console.error(`Failed to trigger analysis for run ${runId}:`, err);
  }
}
