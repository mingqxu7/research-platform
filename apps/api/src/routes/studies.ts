import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { sampleDemographics, buildPersonaText } from "../services/persona-generator";
import { estimateRunCost } from "../services/llm";
import { enqueueRun } from "../queue/experiment-runner";
import type { DemographicSpec } from "../db/types";

const DemographicSpecSchema = z.object({
  age_mean: z.number().min(18).max(80),
  age_sd: z.number().min(1).max(20),
  gender_distribution: z.record(z.number()),
  income_distribution: z.record(z.number()),
  education_distribution: z.record(z.number()),
  occupation_pool: z.array(z.string()).min(1),
});

const CreateStudySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  design_type: z.enum(["between_subjects"], {
    errorMap: () => ({
      message: "V0 only supports between_subjects design. within_subjects is not available yet.",
    }),
  }),
  sample_size: z.number().int().min(10).max(5000),
  demographic_spec: DemographicSpecSchema,
  study_context: z.string().optional(),
  model_version: z.string().default("claude-sonnet-4-6"),
});

const CreateConditionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  order_index: z.number().int().default(0),
  stimulus_type: z.enum(["text", "image", "both"]).optional(),
  stimulus_text: z.string().optional(),
});

const CreateQuestionSchema = z.object({
  text: z.string().min(1),
  scale_type: z.enum(["likert", "continuous", "categorical", "open_ended"]),
  scale_points: z.number().int().optional(),
  scale_labels: z.record(z.string()).optional(),
  order_index: z.number().int().default(0),
});

export async function studyRoutes(app: FastifyInstance): Promise<void> {
  // List studies
  app.get("/studies", async (req) => {
    return db("studies").orderBy("created_at", "desc");
  });

  // Get study
  app.get<{ Params: { id: string } }>("/studies/:id", async (req, reply) => {
    const study = await db("studies").where({ id: req.params.id }).first();
    if (!study) return reply.code(404).send({ error: "Study not found" });

    const [conditions, questions] = await Promise.all([
      db("conditions").where({ study_id: study.id }).orderBy("order_index"),
      db("questions").where({ study_id: study.id }).orderBy("order_index"),
    ]);

    return { ...study, conditions, questions };
  });

  // Create study
  app.post("/studies", async (req, reply) => {
    const body = CreateStudySchema.parse(req.body);
    const [study] = await db("studies").insert(body).returning("*");
    return reply.code(201).send(study);
  });

  // Update study
  app.patch<{ Params: { id: string } }>("/studies/:id", async (req, reply) => {
    const study = await db("studies").where({ id: req.params.id }).first();
    if (!study) return reply.code(404).send({ error: "Study not found" });

    const [updated] = await db("studies")
      .where({ id: req.params.id })
      .update({ ...(req.body as object), updated_at: new Date() })
      .returning("*");
    return updated;
  });

  // Add condition
  app.post<{ Params: { id: string } }>(
    "/studies/:id/conditions",
    async (req, reply) => {
      const study = await db("studies").where({ id: req.params.id }).first();
      if (!study) return reply.code(404).send({ error: "Study not found" });

      const body = CreateConditionSchema.parse(req.body);
      const [condition] = await db("conditions")
        .insert({ ...body, study_id: req.params.id })
        .returning("*");
      return reply.code(201).send(condition);
    },
  );

  // Add question
  app.post<{ Params: { id: string } }>(
    "/studies/:id/questions",
    async (req, reply) => {
      const study = await db("studies").where({ id: req.params.id }).first();
      if (!study) return reply.code(404).send({ error: "Study not found" });

      const body = CreateQuestionSchema.parse(req.body);
      const isOpenEnded = body.scale_type === "open_ended";
      const [question] = await db("questions")
        .insert({ ...body, study_id: req.params.id, is_open_ended: isOpenEnded })
        .returning("*");
      return reply.code(201).send(question);
    },
  );

  // Update condition
  app.patch<{ Params: { id: string; conditionId: string } }>(
    "/studies/:id/conditions/:conditionId",
    async (req, reply) => {
      const condition = await db("conditions")
        .where({ id: req.params.conditionId, study_id: req.params.id })
        .first();
      if (!condition) return reply.code(404).send({ error: "Condition not found" });

      const [updated] = await db("conditions")
        .where({ id: req.params.conditionId })
        .update({ ...(req.body as object), updated_at: new Date() })
        .returning("*");
      return updated;
    },
  );

  // Delete condition
  app.delete<{ Params: { id: string; conditionId: string } }>(
    "/studies/:id/conditions/:conditionId",
    async (req, reply) => {
      const deleted = await db("conditions")
        .where({ id: req.params.conditionId, study_id: req.params.id })
        .delete();
      if (!deleted) return reply.code(404).send({ error: "Condition not found" });
      return reply.code(204).send();
    },
  );

  // Update question
  app.patch<{ Params: { id: string; questionId: string } }>(
    "/studies/:id/questions/:questionId",
    async (req, reply) => {
      const question = await db("questions")
        .where({ id: req.params.questionId, study_id: req.params.id })
        .first();
      if (!question) return reply.code(404).send({ error: "Question not found" });

      const [updated] = await db("questions")
        .where({ id: req.params.questionId })
        .update({ ...(req.body as object), updated_at: new Date() })
        .returning("*");
      return updated;
    },
  );

  // Delete question
  app.delete<{ Params: { id: string; questionId: string } }>(
    "/studies/:id/questions/:questionId",
    async (req, reply) => {
      const deleted = await db("questions")
        .where({ id: req.params.questionId, study_id: req.params.id })
        .delete();
      if (!deleted) return reply.code(404).send({ error: "Question not found" });
      return reply.code(204).send();
    },
  );

  // Upload human benchmarks for Goal 2 comparison
  const BenchmarkSchema = z.object({
    benchmarks: z.array(
      z.object({
        question_id: z.string().uuid().optional(),
        finding_label: z.string().min(1),
        effect_size: z.number(),
        effect_size_type: z.string().min(1),
        ci_lower: z.number().optional(),
        ci_upper: z.number().optional(),
        p_value: z.number().optional(),
        source_citation: z.string().optional(),
      }),
    ).min(1),
  });

  app.post<{ Params: { id: string } }>(
    "/studies/:id/benchmarks",
    async (req, reply) => {
      const study = await db("studies").where({ id: req.params.id }).first();
      if (!study) return reply.code(404).send({ error: "Study not found" });

      const { benchmarks } = BenchmarkSchema.parse(req.body);

      // Delete existing benchmarks for this study, then insert new ones
      await db("human_benchmarks").where({ study_id: req.params.id }).delete();
      const rows = benchmarks.map((b) => ({ ...b, study_id: req.params.id }));
      const inserted = await db("human_benchmarks").insert(rows).returning("*");

      return reply.code(201).send({ inserted: inserted.length, benchmarks: inserted });
    },
  );

  // Get benchmarks for a study
  app.get<{ Params: { id: string } }>(
    "/studies/:id/benchmarks",
    async (req, reply) => {
      const study = await db("studies").where({ id: req.params.id }).first();
      if (!study) return reply.code(404).send({ error: "Study not found" });

      return db("human_benchmarks").where({ study_id: req.params.id });
    },
  );

  // Launch a run — generates personas and enqueues jobs
  app.post<{ Params: { id: string } }>(
    "/studies/:id/runs",
    async (req, reply) => {
      const study = await db("studies").where({ id: req.params.id }).first();
      if (!study) return reply.code(404).send({ error: "Study not found" });

      if (!study.temperature) {
        return reply.code(422).send({
          error:
            "Temperature not calibrated. Run calibration before launching a study.",
        });
      }

      const conditions = await db("conditions").where({ study_id: study.id });
      if (conditions.length < 2) {
        return reply.code(422).send({
          error: "At least 2 conditions required to run a study.",
        });
      }

      const questions = await db("questions").where({ study_id: study.id });
      if (questions.filter((q) => !q.is_open_ended).length === 0) {
        return reply.code(422).send({
          error: "At least one non-open-ended question required.",
        });
      }

      // Cost estimate
      const estimatedCost = estimateRunCost(
        study.sample_size,
        questions.length,
        study.model_version,
      );

      // Create run record
      const [run] = await db("runs")
        .insert({
          study_id: study.id,
          status: "queued",
          total_personas: study.sample_size,
          estimated_cost_usd: estimatedCost,
          run_config: {
            temperature: study.temperature,
            model_version: study.model_version,
          },
        })
        .returning("*");

      // Generate personas with balanced condition assignment
      const personaRows: Array<{
        study_id: string;
        condition_id: string;
        persona_text: string;
        demographics: DemographicSpec;
        persona_index: number;
      }> = [];

      for (let i = 0; i < study.sample_size; i++) {
        const condition = conditions[i % conditions.length];
        const demographics = sampleDemographics(study.demographic_spec as DemographicSpec);
        const personaText = buildPersonaText(demographics);

        personaRows.push({
          study_id: study.id,
          condition_id: condition.id,
          persona_text: personaText,
          demographics: demographics as unknown as DemographicSpec,
          persona_index: i + 1,
        });
      }

      // Insert personas in batches of 500
      for (let i = 0; i < personaRows.length; i += 500) {
        await db("personas").insert(personaRows.slice(i, i + 500));
      }

      // Enqueue all jobs
      await enqueueRun(run.id);

      return reply.code(202).send({
        run_id: run.id,
        status: "queued",
        total_personas: study.sample_size,
        estimated_cost_usd: estimatedCost,
        message: `Queued ${study.sample_size} persona surveys across ${conditions.length} conditions.`,
      });
    },
  );
}
