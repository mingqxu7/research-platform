import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Prevent duplicate analysis results if analysis is triggered more than once
  // for the same run (e.g. network retry after timeout). The Python analyze route
  // uses ON CONFLICT DO NOTHING, which requires this constraint to actually fire.
  await knex.schema.alterTable("analysis_results", (t) => {
    t.unique(["run_id", "question_id"]);
  });

  // Prevent duplicate calibration stats per temperature if the completion
  // handler fires more than once (race condition guard added in experiment-runner).
  await knex.schema.alterTable("calibration_results", (t) => {
    t.unique(["calibration_run_id", "temperature"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("analysis_results", (t) => {
    t.dropUnique(["run_id", "question_id"]);
  });
  await knex.schema.alterTable("calibration_results", (t) => {
    t.dropUnique(["calibration_run_id", "temperature"]);
  });
}
