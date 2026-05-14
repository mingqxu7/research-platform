"""
Analysis endpoint — receives a run_id, loads response data from PostgreSQL,
runs all statistical tests, applies multiple comparison corrections,
evaluates replication criteria, and writes results back to analysis_results.
"""

from __future__ import annotations

import json
import os
from typing import Optional

import asyncpg
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.statistics import (
    AnalysisOutput,
    PowerAnalysisResult,
    apply_multiple_comparison_corrections,
    check_replication_goals,
    power_analysis,
    route_test,
)

router = APIRouter()


class AnalyzeRequest(BaseModel):
    run_id: str
    alpha: float = 0.05


class AnalyzeResponse(BaseModel):
    run_id: str
    questions_analyzed: int
    status: str


class PowerRequest(BaseModel):
    test_type: str = "welch_t"
    effect_size: float
    alpha: float = 0.05
    power: Optional[float] = None
    n_per_group: Optional[int] = None
    n_groups: int = 2


class PowerResponse(BaseModel):
    test_type: str
    solve_for: str
    effect_size: float
    alpha: float
    power: float
    n_per_group: int
    n_groups: int
    effect_size_label: str
    notes: str


async def get_db() -> asyncpg.Connection:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL not set")
    # asyncpg uses postgresql:// scheme
    dsn = dsn.replace("postgres://", "postgresql://")
    return await asyncpg.connect(dsn)


@router.post("/power-analysis", response_model=PowerResponse)
async def compute_power(body: PowerRequest) -> PowerResponse:
    try:
        result: PowerAnalysisResult = power_analysis(
            test_type=body.test_type,
            effect_size=body.effect_size,
            alpha=body.alpha,
            power=body.power,
            n_per_group=body.n_per_group,
            n_groups=body.n_groups,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return PowerResponse(
        test_type=result.test_type,
        solve_for=result.solve_for,
        effect_size=result.effect_size,
        alpha=result.alpha,
        power=result.power,
        n_per_group=result.n_per_group,
        n_groups=result.n_groups,
        effect_size_label=result.effect_size_label,
        notes=result.notes,
    )


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_run(body: AnalyzeRequest) -> AnalyzeResponse:
    conn = await get_db()
    try:
        return await _run_analysis(conn, body.run_id, body.alpha)
    finally:
        await conn.close()


async def _run_analysis(
    conn: asyncpg.Connection, run_id: str, alpha: float
) -> AnalyzeResponse:
    # Verify run exists
    run = await conn.fetchrow("SELECT * FROM runs WHERE id = $1", run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    study_id = run["study_id"]

    # Fetch questions (non-open-ended only)
    questions = await conn.fetch(
        """SELECT id, text, scale_type, scale_points, is_open_ended
           FROM questions WHERE study_id = $1 AND is_open_ended = false
           ORDER BY order_index""",
        study_id,
    )

    # Fetch conditions
    conditions = await conn.fetch(
        "SELECT id, name FROM conditions WHERE study_id = $1 ORDER BY order_index",
        study_id,
    )
    condition_map = {str(c["id"]): c["name"] for c in conditions}

    # Fetch human benchmarks (if any)
    benchmarks = await conn.fetch(
        "SELECT question_id, effect_size, effect_size_type, ci_lower, ci_upper "
        "FROM human_benchmarks WHERE study_id = $1",
        study_id,
    )
    benchmark_map = {
        str(b["question_id"]): {
            "effect_size": b["effect_size"],
            "ci_lower": b["ci_lower"],
            "ci_upper": b["ci_upper"],
        }
        for b in benchmarks
        if b["question_id"]
    }

    outputs: list[AnalysisOutput] = []

    for q in questions:
        q_id = str(q["id"])

        # Fetch all responses for this question in this run
        rows = await conn.fetch(
            """SELECT r.parsed_value, p.condition_id
               FROM responses r
               JOIN personas p ON r.persona_id = p.id
               WHERE r.run_id = $1 AND r.question_id = $2
                 AND r.parse_status = 'ok'
                 AND r.parsed_value IS NOT NULL""",
            run_id,
            q["id"],
        )

        if not rows:
            continue

        # Group values by condition
        groups_dict: dict[str, list[float]] = {}
        for row in rows:
            cid = str(row["condition_id"])
            cname = condition_map.get(cid, cid)
            if cname not in groups_dict:
                groups_dict[cname] = []
            if row["parsed_value"] is not None:
                groups_dict[cname].append(float(row["parsed_value"]))

        groups = [(name, vals) for name, vals in groups_dict.items() if len(vals) >= 2]
        if len(groups) < 2:
            continue

        output = route_test(
            scale_type=q["scale_type"],
            scale_points=q["scale_points"],
            num_conditions=len(groups),
            groups=groups,
            question_id=q_id,
        )
        outputs.append(output)

    # Apply multiple comparison corrections across all tests
    outputs = apply_multiple_comparison_corrections(outputs)

    # Evaluate replication goals and write results
    for output in outputs:
        bm = benchmark_map.get(output.question_id)
        goal1, goal2 = check_replication_goals(
            output,
            alpha_corrected=alpha,
            human_effect_size=bm["effect_size"] if bm else None,
            human_ci_lower=bm["ci_lower"] if bm else None,
            human_ci_upper=bm["ci_upper"] if bm else None,
        )
        output_bm = benchmark_map.get(output.question_id)

        await conn.execute(
            """
            INSERT INTO analysis_results (
                run_id, question_id, test_type, test_statistic,
                p_value_raw, p_value_bonferroni, p_value_bh_fdr,
                correction_method_default,
                effect_size, effect_size_type,
                effect_ci_lower, effect_ci_upper,
                condition_stats,
                levene_stat, levene_p,
                nonparametric_result,
                replicated_goal1, replicated_goal2,
                human_benchmark_effect_size,
                human_benchmark_ci_lower,
                human_benchmark_ci_upper
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13::jsonb, $14, $15, $16::jsonb,
                $17, $18, $19, $20, $21
            )
            ON CONFLICT DO NOTHING
            """,
            run_id,
            output.question_id,
            output.test_type,
            output.test_statistic,
            output.p_value_raw,
            output.p_value_bonferroni,
            output.p_value_bh_fdr,
            "bh_fdr",
            output.effect_size,
            output.effect_size_type,
            output.effect_ci_lower,
            output.effect_ci_upper,
            json.dumps(output.condition_stats),
            output.levene_stat,
            output.levene_p,
            json.dumps(output.nonparametric_result) if output.nonparametric_result else None,
            goal1,
            goal2,
            output_bm["effect_size"] if output_bm else None,
            output_bm["ci_lower"] if output_bm else None,
            output_bm["ci_upper"] if output_bm else None,
        )

    # Mark run complete
    await conn.execute(
        "UPDATE runs SET status = 'complete', completed_at = NOW() WHERE id = $1",
        run_id,
    )

    return AnalyzeResponse(
        run_id=run_id,
        questions_analyzed=len(outputs),
        status="complete",
    )
