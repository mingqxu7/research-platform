import Knex from "knex";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL env var is required");
}

export const db = Knex({
  client: "pg",
  connection: process.env.DATABASE_URL,
  pool: { min: 2, max: 10 },
  migrations: {
    directory: `${__dirname}/migrations`,
    loadExtensions: [".ts", ".js"],
  },
});
