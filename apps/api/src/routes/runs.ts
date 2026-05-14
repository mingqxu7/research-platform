import type { FastifyInstance } from "fastify";
import { db } from "../db/client";

function h(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
        "age",
        "gender",
        "income",
        "education",
        "occupation",
        "question",
        "scale_type",
        "value",
        "parse_status",
      ];
      const rows = responses.map((r) => {
        const d = typeof r.demographics === "string" ? JSON.parse(r.demographics) : (r.demographics ?? {});
        return [
          r.persona_index,
          `"${r.condition_name}"`,
          d.age ?? "",
          d.gender ?? "",
          d.income ?? "",
          d.education ?? "",
          `"${(d.occupation ?? "").replace(/"/g, '""')}"`,
          `"${r.question_text.replace(/"/g, '""')}"`,
          r.scale_type,
          r.parsed_value ?? `"${r.raw_value}"`,
          r.parse_status,
        ].join(",");
      });

      const csv = [headers.join(","), ...rows].join("\n");

      reply.header("Content-Type", "text/csv");
      reply.header(
        "Content-Disposition",
        `attachment; filename="run-${req.params.id}-data.csv"`,
      );
      return reply.send(csv);
    },
  );

  // Generate printable HTML methodology + results report (save as PDF via browser print)
  app.get<{ Params: { id: string } }>(
    "/runs/:id/export/report",
    async (req, reply) => {
      const run = await db("runs").where({ id: req.params.id }).first();
      if (!run) return reply.code(404).send({ error: "Run not found" });

      const study = await db("studies").where({ id: run.study_id }).first();
      const [conditions, questions, results] = await Promise.all([
        db("conditions").where({ study_id: run.study_id }).orderBy("order_index"),
        db("questions").where({ study_id: run.study_id }).orderBy("order_index"),
        db("analysis_results")
          .where({ run_id: req.params.id })
          .join("questions", "analysis_results.question_id", "questions.id")
          .select("analysis_results.*", "questions.text as question_text", "questions.scale_type"),
      ]);

      const analyzed = results.filter((r) => r.replicated_goal1 !== null);
      const goal1Rate =
        analyzed.length > 0
          ? Math.round((analyzed.filter((r) => r.replicated_goal1).length / analyzed.length) * 100)
          : null;
      const goal2Rate =
        analyzed.filter((r) => r.replicated_goal2 !== null).length > 0
          ? Math.round(
              (analyzed.filter((r) => r.replicated_goal2).length /
                analyzed.filter((r) => r.replicated_goal2 !== null).length) *
                100,
            )
          : null;

      const fmtPval = (v: number | null) => (v == null ? "—" : v < 0.001 ? "< .001" : v.toFixed(3));
      const fmtNum = (v: number | null, dp = 3) => (v == null ? "—" : v.toFixed(dp));

      const findingRows = results
        .map(
          (f) => `
        <tr>
          <td>${h(f.question_text)}</td>
          <td>${h(f.test_type ?? "—")}</td>
          <td>${fmtNum(f.test_statistic, 2)}</td>
          <td>${fmtPval(f.p_value_raw)}</td>
          <td>${fmtPval(f.p_value_bh_fdr)}</td>
          <td>${fmtNum(f.effect_size, 3)} (${h(f.effect_size_type ?? "—")})</td>
          <td>${f.replicated_goal1 == null ? "—" : f.replicated_goal1 ? "✓ Yes" : "✗ No"}</td>
          <td>${f.replicated_goal2 == null ? "—" : f.replicated_goal2 ? "✓ Yes" : "✗ No"}</td>
        </tr>`,
        )
        .join("");

      const conditionList = conditions
        .map((c) => `<li><strong>${h(c.name)}</strong>${c.description ? `: ${h(c.description)}` : ""}</li>`)
        .join("");

      const questionList = questions
        .map(
          (q) =>
            `<li>${h(q.text)} <em>(${h(q.scale_type)}${q.scale_points ? `, ${q.scale_points}-pt` : ""})</em></li>`,
        )
        .join("");

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Study Report — ${h(study?.title ?? run.study_id)}</title>
<style>
  body { font-family: Georgia, serif; max-width: 900px; margin: 0 auto; padding: 40px; color: #1a1a1a; font-size: 13px; line-height: 1.6; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin-top: 28px; margin-bottom: 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h3 { font-size: 13px; margin-top: 16px; margin-bottom: 4px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 24px; }
  .scorecard { display: flex; gap: 32px; margin: 16px 0; }
  .score-box { border: 1px solid #ccc; border-radius: 6px; padding: 12px 20px; text-align: center; }
  .score-box .val { font-size: 28px; font-weight: bold; color: #1d4ed8; }
  .score-box .lbl { font-size: 11px; color: #555; margin-top: 2px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 12px; }
  th { background: #f3f4f6; text-align: left; padding: 6px 8px; border: 1px solid #d1d5db; font-weight: 600; }
  td { padding: 5px 8px; border: 1px solid #e5e7eb; vertical-align: top; }
  tr:nth-child(even) td { background: #f9fafb; }
  .warning { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 4px; padding: 10px 14px; margin: 12px 0; font-size: 12px; }
  ul { margin: 6px 0; padding-left: 20px; }
  li { margin-bottom: 4px; }
  .disclaimer { font-size: 11px; color: #6b7280; border-top: 1px solid #e5e7eb; margin-top: 32px; padding-top: 12px; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>

<h1>${h(study?.title ?? "Study Report")}</h1>
<div class="meta">
  Run ID: ${h(run.id)} &nbsp;&bull;&nbsp;
  Model: ${h(study?.model_version ?? "—")} &nbsp;&bull;&nbsp;
  Temperature: ${h(study?.temperature ?? "not set")} &nbsp;&bull;&nbsp;
  N = ${run.total_personas} &nbsp;&bull;&nbsp;
  Completed: ${run.completed_personas} &nbsp;&bull;&nbsp;
  Generated: ${new Date().toISOString().slice(0, 10)}
</div>

<h2>1. Replication Scorecard</h2>
<div class="scorecard">
  <div class="score-box">
    <div class="val">${goal1Rate != null ? goal1Rate + "%" : "—"}</div>
    <div class="lbl">Goal 1 Replication Rate<br>(same direction + p&lt;.05 corrected)</div>
  </div>
  <div class="score-box">
    <div class="val">${goal2Rate != null ? goal2Rate + "%" : "—"}</div>
    <div class="lbl">Goal 2 Replication Rate<br>(effect size 95% CI overlaps human)</div>
  </div>
  <div class="score-box">
    <div class="val">${analyzed.length}</div>
    <div class="lbl">Findings analyzed</div>
  </div>
</div>

<h2>2. Study Design</h2>
<h3>Conditions</h3>
<ul>${conditionList || "<li>No conditions defined.</li>"}</ul>
<h3>Survey Questions</h3>
<ul>${questionList || "<li>No questions defined.</li>"}</ul>

<h2>3. Methodology Disclosure</h2>
<ul>
  <li><strong>Design type:</strong> Between-subjects only. Each AI persona was assigned to exactly one condition. Within-subjects (repeated measures) designs are not supported in V0.</li>
  <li><strong>Independence:</strong> Each persona was a separate, independent LLM API call with no shared context between personas.</li>
  <li><strong>Hypothesis blinding:</strong> Personas were not informed of the study hypothesis or source publication.</li>
  <li><strong>Multiple comparison correction:</strong> Benjamini-Hochberg FDR (default) and Bonferroni corrections applied. Corrected p-values used for the Goal 1 replication flag.</li>
  <li><strong>Default t-test:</strong> Welch's t-test (unequal variance robust) — not Student's t. Levene's test computed as a diagnostic.</li>
  <li><strong>ANOVA effect size:</strong> Partial η² for factorial designs; η² for one-way ANOVA.</li>
  <li><strong>Likert scale treatment:</strong> Parametric tests (Welch's t / ANOVA) applied to Likert items with ≥5 response options; non-parametric alternatives (Mann-Whitney U, Kruskal-Wallis) used for ≤4-point scales. This assumes interval-level measurement of ordinal data — a common social science practice, disclosed here.</li>
  <li><strong>Open-ended questions:</strong> Collected but excluded from statistical analysis in V0. Text analysis module is a V1 addition.</li>
  <li><strong>Model anchoring:</strong> All personas used the same underlying LLM (${h(study?.model_version ?? "—")}). Responses may share subtle systematic biases from model-level anchoring toward common response values. This is an inherent limitation of single-model simulation.</li>
  <li><strong>Temperature:</strong> Fixed at ${h(study?.temperature ?? "not calibrated")} for this study. Temperature was empirically calibrated pre-run to minimize divergence from human response variance distributions.</li>
</ul>

<div class="warning">
  <strong>Validity note:</strong> AI persona responses may not fully represent human behavioral patterns. Effect sizes and replication rates should be interpreted as directional indicators, not substitutes for human panel studies. The Goal 2 criterion (effect size CI overlap with human benchmarks) provides the most rigorous validation — Goal 1 alone can be inflated at large N due to high statistical power.
</div>

<h2>4. Statistical Results</h2>
${
  results.length === 0
    ? "<p>No analysis results available for this run.</p>"
    : `<table>
  <thead>
    <tr>
      <th>Question</th>
      <th>Test</th>
      <th>Statistic</th>
      <th>p (raw)</th>
      <th>p (BH-FDR)</th>
      <th>Effect Size</th>
      <th>Goal 1</th>
      <th>Goal 2</th>
    </tr>
  </thead>
  <tbody>${findingRows}</tbody>
</table>`
}

<div class="disclaimer">
  This report was generated by the AI Research Replication Platform (V0). Statistical analyses were performed using Python scipy/statsmodels. Results have not been peer reviewed. This platform replicates the methodology described in Yeykelis et al. (2024/2025), "Using Large Language Models to Create AI Personas for Replication, Generalization and Prediction of Media Effects."
</div>

</body>
</html>`;

      reply.header("Content-Type", "text/html; charset=utf-8");
      reply.header(
        "Content-Disposition",
        `inline; filename="report-${req.params.id}.html"`,
      );
      return reply.send(html);
    },
  );
}
