# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Research Platform — runs survey-style studies where AI personas (Claude) act as respondents under different stimulus conditions. The platform generates a demographic-weighted sample of personas, queries the LLM in parallel for each, and runs statistical analysis on the responses. Calibration finds a per-study temperature that matches the variance of a human benchmark before the real run executes.

## Services (3 apps, monorepo without a root package manager)

| Service | Stack | Port | Path |
|---|---|---|---|
| `api` | Fastify + TypeScript + Knex (Postgres) + BullMQ (Redis) | 3000 | `apps/api` |
| `analysis` | FastAPI + scipy/statsmodels | 8000 | `apps/analysis` |
| `web` | Next.js 15 App Router + React 19 + Tailwind | 3001 | `apps/web` |

There is no workspace tool (no root `package.json`, no `pnpm-workspace.yaml`). Run commands inside each app directory.

## Common commands

Everything assumes `docker compose up postgres redis` (or `up -d`) is running, or that you `docker compose up` the full stack. The api auto-runs Knex migrations on startup (`db.migrate.latest()` in `apps/api/src/index.ts`); there is no standalone `knexfile.ts`, so the `npm run migrate` script in `apps/api/package.json` will not work without one — start the API to migrate.

```bash
# Full stack
docker compose up                     # all 5 services
docker compose up postgres redis      # infra only, run apps natively

# API (apps/api)
npm install
npm run dev                           # tsx watch, runs migrations + 2 BullMQ workers
npm run build && npm start

# Analysis (apps/analysis)
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
pytest                                # all tests
pytest tests/test_statistics.py::test_name  # single test

# Web (apps/web)
npm install
npm run dev                           # next dev on :3001
npm run build
```

Required env: `DATABASE_URL`, `REDIS_HOST`/`REDIS_PORT`, `ANTHROPIC_API_KEY`, `ANALYSIS_SERVICE_URL` (api → analysis), `NEXT_PUBLIC_API_URL` (web → api).

## Architecture

### Study lifecycle
1. **Create study** (`POST /studies`) — title, demographic spec (age/gender/income/education/occupation distributions), sample size, model version, optional study_context. Add `conditions` (between-subjects only) and `questions` (likert / continuous / categorical / open_ended).
2. **Power recommendation** (`/power` routes) — suggests sample size before commit.
3. **Calibration** (`/calibration` routes, `calibration-runner.ts` worker) — runs a small persona batch at several temperatures, compares variance against an uploaded human benchmark, picks the temperature that best matches, writes it onto the study. Temperature is locked per study after calibration.
4. **Run** (`enqueueRun` in `experiment-runner.ts`) — generates N personas via `services/persona-generator.ts` (samples demographics from the study's `DemographicSpec`, builds natural-language persona text), enqueues one BullMQ job per persona on the `persona-survey` queue. Worker concurrency capped at 50; exponential backoff on 529/overload from Anthropic. Run lifecycle: `queued → running → processing → complete | failed`. `checkRunCompletion` triggers analysis when all personas have responded.
5. **Analysis** — api calls the FastAPI analysis service, which runs the appropriate test per scale type, applies multiple-comparison corrections (Bonferroni, BH-FDR), and writes `analysis_results`.

### Cross-service contracts
- **api ↔ analysis**: api POSTs run data to analysis service (`ANALYSIS_SERVICE_URL`); analysis writes results back to Postgres directly (both services share `DATABASE_URL`). Keep schema changes coordinated — Knex migrations live in `apps/api/src/db/migrations/`, but the Python service reads the same tables.
- **api ↔ Anthropic**: all LLM calls go through `apps/api/src/services/llm.ts`. `runPersonaSurvey` returns parsed responses + token usage; the worker increments `runs.tokens_used` per job.
- **web ↔ api**: REST via `NEXT_PUBLIC_API_URL`. React Query handles fetching/cache.

### Database model (key tables)
`users → studies → {conditions, questions} → personas → runs → responses → analysis_results`. Plus a parallel calibration track: `calibration_runs → calibration_personas → calibration_responses → calibration_results`, and `human_benchmarks` (uploaded reference effect sizes used to pick calibration temperature). Full schema in `apps/api/src/db/migrations/001_initial_schema.ts` and types in `apps/api/src/db/types.ts`.

### Templates
`apps/api/src/data/templates.ts` ships built-in study templates surfaced at `/templates` in the web UI and via the templates route.

## Conventions

- TypeScript: strict mode, ESM, `tsx` for dev. Validate inbound payloads with `zod` schemas at the route boundary (pattern in `routes/studies.ts`).
- BullMQ: long-running work goes through workers, not request handlers. Workers are started inside `apps/api/src/index.ts` — don't fork them out.
- Migrations: append a new file `00N_*.ts` under `apps/api/src/db/migrations/`. Both `up` and `down` are required. They auto-run on api startup.
- Python: tests under `apps/analysis/tests/`, pytest only.
- The web app reads `NEXT_PUBLIC_API_URL` directly in client components; no API proxy layer.

## Known gotchas

- `npm run migrate` in `apps/api` invokes `knex migrate:latest` but there's no `knexfile.ts` — migrations are driven by the in-process Knex instance in `db/client.ts`. Start the API (or call `db.migrate.latest()` programmatically) to migrate.
- `docs/` contains the GitHub Pages landing page (`index.html`) and methodology reference (`methodology/index.html`). The canonical product spec lives in commit messages and code comments (e.g., calibration workflow references "spec Section 7.2" — see commit `5bdcbe0`).
- Per-study `temperature` is null until calibration completes; runs that depend on it must check.
