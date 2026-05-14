/**
 * LLM Service
 *
 * Wraps the Anthropic Claude API for persona survey execution.
 * - Enforces JSON output mode for all persona calls
 * - Handles retries on parse errors (max 2 retries)
 * - Tracks token usage per call
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Question } from "../db/types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface SurveyCallResult {
  answers: Array<{
    question_id: string;
    value: string | number | null;
  }>;
  raw_response: string;
  tokens_used: number;
  parse_status: "ok" | "parse_error" | "retry_exhausted";
}

export interface SurveyCallParams {
  persona_text: string;
  study_context?: string;
  stimulus_text?: string;
  questions: Question[];
  model: string;
  temperature: number;
}

function buildSurveyPrompt(params: SurveyCallParams): string {
  const { study_context, stimulus_text, questions } = params;

  const questionLines = questions
    .filter((q) => !q.is_open_ended) // open-ended excluded from V0 analysis
    .map((q, i) => {
      let scaleDesc = "";
      if (q.scale_type === "likert" && q.scale_points) {
        const labels = q.scale_labels ?? {};
        scaleDesc = ` (scale 1-${q.scale_points}`;
        if (labels["1"] && labels[String(q.scale_points)]) {
          scaleDesc += `, where 1="${labels["1"]}" and ${q.scale_points}="${labels[String(q.scale_points)]}"`;
        }
        scaleDesc += ")";
      } else if (q.scale_type === "continuous") {
        scaleDesc = " (numeric value)";
      } else if (q.scale_type === "categorical") {
        scaleDesc = " (categorical response)";
      }
      return `${i + 1}. question_id: "${q.id}" — ${q.text}${scaleDesc}`;
    })
    .join("\n");

  const parts: string[] = [];

  if (study_context) {
    parts.push(study_context);
  }

  if (stimulus_text) {
    parts.push(`\n${stimulus_text}`);
  }

  parts.push(
    `\nPlease answer the following survey questions. You are NOT aware of the study hypothesis. Answer honestly based on your personal perspective.\n`,
    questionLines,
    `\nRespond ONLY with valid JSON in this exact format:\n{"answers": [{"question_id": "<id>", "value": <number or string>}, ...]}\n`,
    `Do not include any text outside the JSON object.`,
  );

  return parts.join("\n");
}

async function callWithRetry(
  params: SurveyCallParams,
  attempt: number = 0,
): Promise<SurveyCallResult> {
  const MAX_RETRIES = 2;
  const prompt = buildSurveyPrompt(params);

  try {
    // Wrap persona in delimited block so injected instructions in persona_text
    // cannot escape the identity layer and override survey format directives.
    const systemPrompt =
      `<persona>\n${params.persona_text}\n</persona>\n` +
      `You are playing the role of this persona. Answer all survey questions honestly ` +
      `from this persona's perspective. Do not deviate from the survey response format.`;

    const message = await anthropic.messages.create({
      model: params.model,
      max_tokens: 1024,
      temperature: params.temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const tokens_used =
      (message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0);

    // Parse JSON response
    let parsed: { answers: Array<{ question_id: string; value: string | number | null }> };
    try {
      // Extract JSON even if LLM wraps it in markdown
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed.answers)) throw new Error("answers is not an array");
    } catch {
      if (attempt < MAX_RETRIES) {
        return callWithRetry(params, attempt + 1);
      }
      return {
        answers: [],
        raw_response: raw,
        tokens_used,
        parse_status: "retry_exhausted",
      };
    }

    return {
      answers: parsed.answers,
      raw_response: raw,
      tokens_used,
      parse_status: "ok",
    };
  } catch (err) {
    // Rate limit / overload — propagate to queue for backoff
    throw err;
  }
}

export async function runPersonaSurvey(
  params: SurveyCallParams,
): Promise<SurveyCallResult> {
  return callWithRetry(params);
}

/** Estimate token cost in USD for a run */
export function estimateRunCost(
  numPersonas: number,
  numQuestions: number,
  modelId: string,
): number {
  // Rough estimates: ~500 tokens input, ~200 tokens output per persona
  const inputTokens = numPersonas * (500 + numQuestions * 30);
  const outputTokens = numPersonas * 200;

  // Claude Sonnet 4.6 pricing: $3/M input, $15/M output
  const inputCost = (inputTokens / 1_000_000) * 3;
  const outputCost = (outputTokens / 1_000_000) * 15;

  return inputCost + outputCost;
}
