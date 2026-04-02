/** TypeScript types mirroring the PostgreSQL schema */

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface DemographicSpec {
  age_mean: number;
  age_sd: number;
  gender_distribution: Record<string, number>; // { male: 0.5, female: 0.5 }
  income_distribution: Record<string, number>;
  education_distribution: Record<string, number>;
  occupation_pool: string[];
}

export interface Study {
  id: string;
  owner_id: string;
  title: string;
  description?: string;
  status: "draft" | "active" | "completed";
  design_type: "between_subjects";
  sample_size: number;
  demographic_spec: DemographicSpec;
  model_version: string;
  temperature?: number;
  max_concurrency: number;
  study_context?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Condition {
  id: string;
  study_id: string;
  name: string;
  description?: string;
  order_index: number;
  stimulus_type?: "text" | "image" | "both";
  stimulus_text?: string;
  stimulus_s3_key?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Question {
  id: string;
  study_id: string;
  text: string;
  scale_type: "likert" | "continuous" | "categorical" | "open_ended";
  scale_points?: number;
  scale_labels?: Record<string, string>;
  is_open_ended: boolean;
  order_index: number;
  created_at: Date;
  updated_at: Date;
}

export interface Persona {
  id: string;
  study_id: string;
  condition_id: string;
  persona_text: string;
  demographics: Record<string, unknown>;
  persona_index: number;
  created_at: Date;
  updated_at: Date;
}

export type RunStatus = "queued" | "running" | "processing" | "complete" | "failed";

export interface Run {
  id: string;
  study_id: string;
  status: RunStatus;
  total_personas: number;
  completed_personas: number;
  failed_personas: number;
  tokens_used: number;
  estimated_cost_usd?: number;
  run_config?: Record<string, unknown>;
  started_at?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export type ParseStatus = "ok" | "parse_error" | "retry_exhausted";

export interface Response {
  id: string;
  run_id: string;
  persona_id: string;
  question_id: string;
  raw_value?: string;
  parsed_value?: number;
  parse_status: ParseStatus;
  retry_count: number;
  raw_llm_response?: string;
  created_at: Date;
  updated_at: Date;
}

export interface AnalysisResult {
  id: string;
  run_id: string;
  question_id: string;
  test_type: string;
  test_statistic?: number;
  p_value_raw?: number;
  p_value_bonferroni?: number;
  p_value_bh_fdr?: number;
  correction_method_default: string;
  effect_size?: number;
  effect_size_type?: string;
  effect_ci_lower?: number;
  effect_ci_upper?: number;
  condition_stats?: Record<string, { mean: number; sd: number; se: number; n: number }>;
  levene_stat?: number;
  levene_p?: number;
  nonparametric_result?: Record<string, unknown>;
  replicated_goal1?: boolean;
  replicated_goal2?: boolean;
  human_benchmark_effect_size?: number;
  human_benchmark_ci_lower?: number;
  human_benchmark_ci_upper?: number;
  created_at: Date;
  updated_at: Date;
}
