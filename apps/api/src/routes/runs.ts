import type { FastifyInstance } from "fastify";
import { db } from "../db/client";

export async function runRoutes(app: FastifyInstance): Promise<void> {
  // Get run status and progress
  app.get<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    const run = await db("runs").where({ id: req.params.id }).first();
    if (!run) return reply.code(404).send({ error: "Run not found" });

    const progressPct =
      run.total_personas > 0
        ? Math.round((run.completed_personas / run.total_personas) * 100)
        : 0;

    return {
      ...run,
      progress_pct: progressPct,
    };
  });

  // List runs for a study
  app.get<{ Params: { studyId: string } }>(
    "/studies/:studyId/runs",
    async (req, reply) => {
      const study = await db("studies").where({ id: req.params.studyId }).first();
      if (!study) return reply.code(404).send({ error: "Study not found" });

      return db("runs")
        .where({ study_id: req.params.studyId })
        .orderBy("created_at", "desc");
    },
  );

  // Get analysis results for a run
  app.get<{ Params: { id: string } }>(
    "/runs/:id/results",
    async (req, reply) => {
      const run = await db("runs").where({ id: req.params.id }).first();
      if (!run) return reply.code(404).send({ error: "Run not found" });

      const results = await db("analysis_results")
        .where({ run_id: req.params.id })
        .join("questions", "analysis_results.question_id", "questions.id")
        .select(
          "analysis_results.*",
          "questions.text as question_text",
          "questions.scale_type",
        );

      // Compute replication rates
      const analyzed = results.filter((r) => r.replicated_goal1 !== null);
      const goal1Rate =
        analyzed.length > 0
          ? Math.round(
              (analyzed.filter((r) => r.replicated_goal1).length / analyzed.length) * 100,
            )
          : null;
      const goal2Rate =
        analyzed.filter((r) => r.replicated_goal2 !== null).length > 0
          ? Math.round(
              (analyzed.filter((r) => r.replicated_goal2).length /
                analyzed.filter((r) => r.replicated_goal2 !== null).length) *
                100,
            )
          : null;

      return {
        run,
        replication_rates: {
          goal1_pct: goal1Rate,
          goal2_pct: goal2Rate,
        },
        findings: results,
      };
    },
  );

  // Download raw persona-level CSV
  app.get<{ Params: { id: string } }>(
    "/runs/:id/export/csv",
    async (req, reply) => {
      const run = await db("runs").where({ id: req.params.id }).first();
      if (!run) return reply.code(404).send({ error: "Run not found" });

      const responses = await db("responses")
        .where({ run_id: req.params.id })
        .join("personas", "responses.persona_id", "personas.id")
        .join("questions", "responses.question_id", "questions.id")
        .join("conditions", "personas.condition_id", "conditions.id")
        .select(
          "personas.persona_index",
          "personas.demographics",
          "conditions.name as condition_name",
          "questions.text as question_text",
          "questions.scale_type",
          "responses.parsed_value",
          "responses.raw_value",
          "responses.parse_status",
        );

      if (responses.length === 0) {
        return reply.code(404).send({ error: "No responses found" });
      }

      // Build CSV
      const headers = [
        "persona_index",
        "condition",
        "question",
        "scale_type",
        "value",
        "parse_status",
      ];
      const rows = responses.map((r) =>
        [
          r.persona_index,
          `"${r.condition_name}"`,
          `"${r.question_text.replace(/"/g, '""')}"`,
          r.scale_type,
          r.parsed_value ?? `"${r.raw_value}"`,
          r.parse_status,
        ].join(","),
      );

      const csv = [headers.join(","), ...rows].join("\n");

      reply.header("Content-Type", "text/csv");
      reply.header(
        "Content-Disposition",
        `attachment; filename="run-${req.params.id}-data.csv"`,
      );
      return reply.send(csv);
    },
  );
}
