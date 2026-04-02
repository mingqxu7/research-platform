import type { FastifyInstance } from "fastify";
import { db } from "../db/client";
import { STUDY_TEMPLATES } from "../data/templates";

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  // List all templates
  app.get("/templates", async () => {
    return STUDY_TEMPLATES.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      source_citation: t.source_citation,
      research_area: t.research_area,
      design_summary: t.design_summary,
      sample_size: t.sample_size,
      condition_count: t.conditions.length,
      question_count: t.questions.length,
      expected_findings: t.expected_findings,
    }));
  });

  // Get a single template with full detail
  app.get<{ Params: { id: string } }>("/templates/:id", async (req, reply) => {
    const template = STUDY_TEMPLATES.find((t) => t.id === req.params.id);
    if (!template) return reply.code(404).send({ error: "Template not found" });
    return template;
  });

  // Clone a template into a new study
  app.post<{ Params: { id: string } }>(
    "/templates/:id/clone",
    async (req, reply) => {
      const template = STUDY_TEMPLATES.find((t) => t.id === req.params.id);
      if (!template) return reply.code(404).send({ error: "Template not found" });

      // Create the study
      const [study] = await db("studies")
        .insert({
          title: `${template.title} (from template)`,
          description: template.description,
          sample_size: template.sample_size,
          demographic_spec: template.demographic_spec,
          study_context: template.study_context,
          status: "draft",
          design_type: "between_subjects",
        })
        .returning("*");

      // Create conditions
      const conditionRows = template.conditions.map((c) => ({
        study_id: study.id,
        name: c.name,
        description: c.description,
        order_index: c.order_index,
        stimulus_type: c.stimulus_type,
        stimulus_text: c.stimulus_text ?? null,
      }));
      await db("conditions").insert(conditionRows);

      // Create questions
      const questionRows = template.questions.map((q) => ({
        study_id: study.id,
        text: q.text,
        scale_type: q.scale_type,
        scale_points: q.scale_points ?? null,
        scale_labels: q.scale_labels ? JSON.stringify(q.scale_labels) : null,
        is_open_ended: q.scale_type === "open_ended",
        order_index: q.order_index,
      }));
      await db("questions").insert(questionRows);

      return reply.code(201).send({
        study_id: study.id,
        message: `Study created from template: ${template.title}`,
      });
    },
  );
}
