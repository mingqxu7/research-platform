import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Link personas to the run that created them.
  // Without this, enqueueRun queries personas WHERE study_id = run.study_id,
  // which returns ALL personas from every prior run on the same study,
  // causing duplicate jobs and premature completion on any second run.
  await knex.schema.alterTable("personas", (t) => {
    t.uuid("run_id").nullable().references("id").inTable("runs").onDelete("CASCADE");
    t.index("run_id");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("personas", (t) => {
    t.dropIndex("run_id");
    t.dropColumn("run_id");
  });
}
