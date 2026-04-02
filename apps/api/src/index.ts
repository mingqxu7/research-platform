import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { studyRoutes } from "./routes/studies";
import { runRoutes } from "./routes/runs";
import { powerRoutes } from "./routes/power";
import { db } from "./db/client";
import { startWorker } from "./queue/experiment-runner";

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === "production" ? "warn" : "info",
  },
});

app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? "*",
});

// Health check
app.get("/health", async () => ({ status: "ok", service: "api" }));

// Routes
app.register(studyRoutes);
app.register(runRoutes);
app.register(powerRoutes);

// Global error handler
app.setErrorHandler((error, req, reply) => {
  if (error.name === "ZodError") {
    return reply.code(400).send({ error: "Validation error", details: error.message });
  }
  app.log.error(error);
  return reply.code(500).send({ error: "Internal server error" });
});

async function start(): Promise<void> {
  try {
    // Run DB migrations
    await db.migrate.latest();
    app.log.info("Database migrations complete");

    // Start Bull worker
    const worker = startWorker();
    worker.on("completed", (job) => {
      app.log.info({ jobId: job.id }, "Persona survey completed");
    });
    worker.on("failed", (job, err) => {
      app.log.error({ jobId: job?.id, err }, "Persona survey failed");
    });

    const port = Number(process.env.PORT ?? 3000);
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info(`API server running on port ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
