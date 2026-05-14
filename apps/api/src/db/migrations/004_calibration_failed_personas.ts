import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Track job-level failures (BullMQ retry exhaustion) separately from
  // parse-level failures. Without this, a calibration run whose jobs all
  // fail before inserting any response rows will never reach
  // completed + failed >= total, leaving the run stuck in "running" forever.
  await knex.schema.alterTable("calibration_runs", (t) => {
    t.integer("failed_personas").notNullable().defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("calibration_runs", (t) => {
    t.dropColumn("failed_personas");
  });
}
