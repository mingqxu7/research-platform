import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Users table
  await knex.schema.createTable("users", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.string("email").notNullable().unique();
    t.string("name").notNullable();
    t.timestamps(true, true);
  });

  // Studies table
  await knex.schema.createTable("studies", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("owner_id").references("id").inTable("users").onDelete("CASCADE");
    t.string("title").notNullable();
    t.text("description");
    t.string("status").notNullable().defaultTo("draft"); // draft | active | completed
    t.string("design_type").notNullable().defaultTo("between_subjects");
    t.integer("sample_size").notNullable().defaultTo(100);
    t.jsonb("demographic_spec").notNullable().defaultTo("{}");
    // LLM config — temperature is locked per study after calibration
    t.string("model_version").notNullable().defaultTo("claude-sonnet-4-6");
    t.float("temperature"); // null until calibration completed
    t.integer("max_concurrency").notNullable().defaultTo(50);
    t.string("study_context"); // optional framing text
    t.timestamps(true, true);
  });

  // Conditions table
  await knex.schema.createTable("conditions", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("study_id").notNullable().references("id").inTable("studies").onDelete("CASCADE");
    t.string("name").notNullable();
    t.text("description");
    t.integer("order_index").notNullable().defaultTo(0);
    t.string("stimulus_type"); // text | image | both
    t.text("stimulus_text");
    t.string("stimulus_s3_key"); // S3 key for image
    t.timestamps(true, true);
  });

  // Questions table
  await knex.schema.createTable("questions", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("study_id").notNullable().references("id").inTable("studies").onDelete("CASCADE");
    t.text("text").notNullable();
    t.string("scale_type").notNullable(); // likert | continuous | categorical | open_ended
    t.integer("scale_points"); // for likert: 5, 7, etc.
    t.jsonb("scale_labels"); // for likert: {1: "Strongly Disagree", 7: "Strongly Agree"}
    t.boolean("is_open_ended").notNullable().defaultTo(false);
    t.integer("order_index").notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  // Personas table
  await knex.schema.createTable("personas", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("study_id").notNullable().references("id").inTable("studies").onDelete("CASCADE");
    t.uuid("condition_id").notNullable().references("id").inTable("conditions").onDelete("CASCADE");
    t.text("persona_text").notNullable(); // the generated natural-language description
    t.jsonb("demographics").notNullable(); // age, gender, income, etc.
    t.integer("persona_index").notNullable(); // 1..N
    t.timestamps(true, true);
  });

  // Runs table
  await knex.schema.createTable("runs", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("study_id").notNullable().references("id").inTable("studies").onDelete("CASCADE");
    t.string("status").notNullable().defaultTo("queued"); // queued | running | processing | complete | failed
    t.integer("total_personas").notNullable().defaultTo(0);
    t.integer("completed_personas").notNullable().defaultTo(0);
    t.integer("failed_personas").notNullable().defaultTo(0);
    t.bigInteger("tokens_used").defaultTo(0);
    t.decimal("estimated_cost_usd", 10, 6);
    t.jsonb("run_config"); // temperature, model version, etc. at run time
    t.timestamp("started_at");
    t.timestamp("completed_at");
    t.timestamps(true, true);
  });

  // Responses table
  await knex.schema.createTable("responses", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("run_id").notNullable().references("id").inTable("runs").onDelete("CASCADE");
    t.uuid("persona_id").notNullable().references("id").inTable("personas").onDelete("CASCADE");
    t.uuid("question_id").notNullable().references("id").inTable("questions").onDelete("CASCADE");
    t.text("raw_value"); // the raw parsed value from LLM
    t.float("parsed_value"); // numeric value (null for open-ended or parse errors)
    t.string("parse_status").notNullable().defaultTo("ok"); // ok | parse_error | retry_exhausted
    t.integer("retry_count").notNullable().defaultTo(0);
    t.text("raw_llm_response"); // full LLM response for audit
    t.timestamps(true, true);
  });

  // Analysis results table
  await knex.schema.createTable("analysis_results", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("run_id").notNullable().references("id").inTable("runs").onDelete("CASCADE");
    t.uuid("question_id").notNullable().references("id").inTable("questions").onDelete("CASCADE");
    t.string("test_type").notNullable(); // welch_t | welch_anova | two_way_anova | chi_square | mann_whitney | kruskal_wallis | ancova
    t.float("test_statistic");
    t.float("p_value_raw");
    t.float("p_value_bonferroni");
    t.float("p_value_bh_fdr");
    t.string("correction_method_default").notNullable().defaultTo("bh_fdr");
    t.float("effect_size");
    t.string("effect_size_type"); // cohens_d | partial_eta2 | eta2 | cramers_v | rank_biserial | epsilon_squared
    t.float("effect_ci_lower");
    t.float("effect_ci_upper");
    t.jsonb("condition_stats"); // per-condition: {condition_id: {mean, sd, se, n}}
    t.float("levene_stat");
    t.float("levene_p");
    t.jsonb("nonparametric_result"); // Mann-Whitney / Kruskal-Wallis result
    t.boolean("replicated_goal1"); // same direction + corrected p < .05
    t.boolean("replicated_goal2"); // 95% CI overlaps human benchmark
    t.float("human_benchmark_effect_size"); // if uploaded
    t.float("human_benchmark_ci_lower");
    t.float("human_benchmark_ci_upper");
    t.timestamps(true, true);
  });

  // Human benchmarks table (uploaded reference studies)
  await knex.schema.createTable("human_benchmarks", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("study_id").notNullable().references("id").inTable("studies").onDelete("CASCADE");
    t.uuid("question_id").references("id").inTable("questions").onDelete("SET NULL");
    t.string("finding_label").notNullable();
    t.float("effect_size").notNullable();
    t.string("effect_size_type").notNullable();
    t.float("ci_lower");
    t.float("ci_upper");
    t.float("p_value");
    t.string("source_citation");
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("human_benchmarks");
  await knex.schema.dropTableIfExists("analysis_results");
  await knex.schema.dropTableIfExists("responses");
  await knex.schema.dropTableIfExists("runs");
  await knex.schema.dropTableIfExists("personas");
  await knex.schema.dropTableIfExists("questions");
  await knex.schema.dropTableIfExists("conditions");
  await knex.schema.dropTableIfExists("studies");
  await knex.schema.dropTableIfExists("users");
}
