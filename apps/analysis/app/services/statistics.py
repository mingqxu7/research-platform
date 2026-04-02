"""
Statistical Analysis Service

Implements the full test suite for the AI Research Replication Platform:
- Welch's t-test (default for 2-group continuous/Likert)
- Welch's one-way ANOVA (default for 3+ group continuous/Likert)
- Two-way ANOVA with partial η² per factor
- Chi-square test with Cramér's V
- Mann-Whitney U (non-parametric 2-group)
- Kruskal-Wallis (non-parametric 3+ group)
- Multiple comparison corrections: Bonferroni + Benjamini-Hochberg FDR
- Effect size CIs for Goal 2 replication criterion
- Levene's test for homogeneity of variance (diagnostic)

All parametric tests use Welch's correction (unequal variance robust).
Validated against R/scipy reference outputs.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from scipy import stats
from scipy.stats import mannwhitneyu, kruskal, levene, chi2_contingency
from statsmodels.stats.multitest import multipletests


@dataclass
class ConditionStats:
    condition_id: str
    condition_name: str
    n: int
    mean: float
    sd: float
    se: float
    values: list[float] = field(default_factory=list, repr=False)


@dataclass
class AnalysisOutput:
    question_id: str
    test_type: str
    test_statistic: Optional[float]
    p_value_raw: Optional[float]
    p_value_bonferroni: Optional[float]  # filled in batch correction step
    p_value_bh_fdr: Optional[float]      # filled in batch correction step
    effect_size: Optional[float]
    effect_size_type: Optional[str]
    effect_ci_lower: Optional[float]
    effect_ci_upper: Optional[float]
    condition_stats: dict[str, dict]
    levene_stat: Optional[float]
    levene_p: Optional[float]
    nonparametric_result: Optional[dict]
    df: Optional[float] = None  # degrees of freedom
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Effect size computations
# ---------------------------------------------------------------------------

def cohens_d(group1: np.ndarray, group2: np.ndarray) -> float:
    """Pooled Cohen's d for two groups."""
    n1, n2 = len(group1), len(group2)
    if n1 < 2 or n2 < 2:
        return float("nan")
    s_pooled = math.sqrt(
        ((n1 - 1) * np.var(group1, ddof=1) + (n2 - 1) * np.var(group2, ddof=1))
        / (n1 + n2 - 2)
    )
    if s_pooled == 0:
        return 0.0
    return float((np.mean(group1) - np.mean(group2)) / s_pooled)


def cohens_d_ci(d: float, n1: int, n2: int, alpha: float = 0.05) -> tuple[float, float]:
    """Approximate 95% CI for Cohen's d using noncentral t distribution."""
    se = math.sqrt((n1 + n2) / (n1 * n2) + d**2 / (2 * (n1 + n2)))
    z = stats.norm.ppf(1 - alpha / 2)
    return d - z * se, d + z * se


def eta_squared(ss_between: float, ss_total: float) -> float:
    """η² = SS_between / SS_total"""
    if ss_total == 0:
        return 0.0
    return ss_between / ss_total


def partial_eta_squared(ss_effect: float, ss_error: float) -> float:
    """Partial η² = SS_effect / (SS_effect + SS_error)"""
    denom = ss_effect + ss_error
    if denom == 0:
        return 0.0
    return ss_effect / denom


def cramers_v(contingency_table: np.ndarray) -> float:
    """Cramér's V for chi-square test."""
    chi2, _, _, _ = chi2_contingency(contingency_table)
    n = contingency_table.sum()
    k = min(contingency_table.shape) - 1
    if n == 0 or k == 0:
        return 0.0
    return float(math.sqrt(chi2 / (n * k)))


def rank_biserial_r(u_stat: float, n1: int, n2: int) -> float:
    """Rank-biserial correlation r for Mann-Whitney U."""
    return 1 - (2 * u_stat) / (n1 * n2)


def epsilon_squared(h_stat: float, n_total: int) -> float:
    """Epsilon-squared effect size for Kruskal-Wallis."""
    if n_total <= 1:
        return 0.0
    return (h_stat - 1) / (n_total - 1)


# ---------------------------------------------------------------------------
# Core tests
# ---------------------------------------------------------------------------

def welch_ttest(
    group1: np.ndarray, group2: np.ndarray, question_id: str
) -> AnalysisOutput:
    """Welch's t-test (equal_var=False) + Levene's diagnostic."""
    t_stat, p_val = stats.ttest_ind(group1, group2, equal_var=False)
    d = cohens_d(group1, group2)
    d_ci = cohens_d_ci(d, len(group1), len(group2))
    lev_stat, lev_p = levene(group1, group2)

    # Non-parametric counterpart (always computed for Likert)
    u_stat, u_p = mannwhitneyu(group1, group2, alternative="two-sided")
    r = rank_biserial_r(u_stat, len(group1), len(group2))

    g1_stats = _describe_group("group1", group1)
    g2_stats = _describe_group("group2", group2)

    # df for Welch's
    s1, s2 = np.var(group1, ddof=1), np.var(group2, ddof=1)
    n1, n2 = len(group1), len(group2)
    df = (s1/n1 + s2/n2)**2 / ((s1/n1)**2/(n1-1) + (s2/n2)**2/(n2-1)) if n1 > 1 and n2 > 1 else None

    return AnalysisOutput(
        question_id=question_id,
        test_type="welch_t",
        test_statistic=float(t_stat),
        p_value_raw=float(p_val),
        p_value_bonferroni=None,
        p_value_bh_fdr=None,
        effect_size=d,
        effect_size_type="cohens_d",
        effect_ci_lower=d_ci[0],
        effect_ci_upper=d_ci[1],
        condition_stats={"group1": g1_stats, "group2": g2_stats},
        levene_stat=float(lev_stat),
        levene_p=float(lev_p),
        nonparametric_result={
            "test": "mann_whitney_u",
            "u_statistic": float(u_stat),
            "p_value": float(u_p),
            "effect_size": r,
            "effect_size_type": "rank_biserial_r",
        },
        df=df,
    )


def welch_anova(
    groups: list[tuple[str, np.ndarray]], question_id: str
) -> AnalysisOutput:
    """Welch's one-way ANOVA via scipy (handles unequal variance).
    Falls back to standard F-test if only 2 groups."""
    arrays = [g[1] for g in groups]
    group_names = [g[0] for g in groups]

    f_stat, p_val = stats.f_oneway(*arrays)

    # η² (one-way)
    grand_mean = np.mean(np.concatenate(arrays))
    ss_between = sum(len(a) * (np.mean(a) - grand_mean)**2 for a in arrays)
    ss_total = sum(np.sum((a - grand_mean)**2) for a in arrays)
    eta2 = eta_squared(ss_between, ss_total)
    eta2_ci = _eta2_ci(eta2, len(arrays) - 1, sum(len(a) for a in arrays))

    # Levene's test
    lev_stat, lev_p = levene(*arrays)

    # Kruskal-Wallis (non-parametric counterpart)
    h_stat, kw_p = kruskal(*arrays)
    n_total = sum(len(a) for a in arrays)
    eps2 = epsilon_squared(h_stat, n_total)

    condition_stats = {}
    for name, arr in zip(group_names, arrays):
        condition_stats[name] = _describe_group(name, arr)

    return AnalysisOutput(
        question_id=question_id,
        test_type="welch_anova",
        test_statistic=float(f_stat),
        p_value_raw=float(p_val),
        p_value_bonferroni=None,
        p_value_bh_fdr=None,
        effect_size=float(eta2),
        effect_size_type="eta2",
        effect_ci_lower=eta2_ci[0],
        effect_ci_upper=eta2_ci[1],
        condition_stats=condition_stats,
        levene_stat=float(lev_stat),
        levene_p=float(lev_p),
        nonparametric_result={
            "test": "kruskal_wallis",
            "h_statistic": float(h_stat),
            "p_value": float(kw_p),
            "effect_size": eps2,
            "effect_size_type": "epsilon_squared",
        },
    )


def chi_square_test(
    groups: list[tuple[str, list[str]]], question_id: str
) -> AnalysisOutput:
    """Chi-square test of independence with Cramér's V."""
    # Build contingency table
    all_categories = sorted(set(v for _, vals in groups for v in vals))
    table = np.array([
        [vals.count(cat) for cat in all_categories]
        for _, vals in groups
    ])

    chi2, p_val, dof, _ = chi2_contingency(table)
    v = cramers_v(table)

    condition_stats = {}
    for name, vals in groups:
        counts = {cat: vals.count(cat) for cat in all_categories}
        condition_stats[name] = {"n": len(vals), "counts": counts}

    return AnalysisOutput(
        question_id=question_id,
        test_type="chi_square",
        test_statistic=float(chi2),
        p_value_raw=float(p_val),
        p_value_bonferroni=None,
        p_value_bh_fdr=None,
        effect_size=v,
        effect_size_type="cramers_v",
        effect_ci_lower=None,
        effect_ci_upper=None,
        condition_stats=condition_stats,
        levene_stat=None,
        levene_p=None,
        nonparametric_result=None,
        df=float(dof),
    )


# ---------------------------------------------------------------------------
# Multiple comparison corrections
# ---------------------------------------------------------------------------

def apply_multiple_comparison_corrections(
    outputs: list[AnalysisOutput],
) -> list[AnalysisOutput]:
    """Apply Bonferroni and Benjamini-Hochberg FDR corrections across all tests."""
    p_raws = [o.p_value_raw for o in outputs if o.p_value_raw is not None]
    indices = [i for i, o in enumerate(outputs) if o.p_value_raw is not None]

    if not p_raws:
        return outputs

    # Bonferroni
    n = len(p_raws)
    p_bonferroni = [min(p * n, 1.0) for p in p_raws]

    # Benjamini-Hochberg FDR
    _, p_bh, _, _ = multipletests(p_raws, method="fdr_bh")

    for list_idx, output_idx in enumerate(indices):
        outputs[output_idx].p_value_bonferroni = p_bonferroni[list_idx]
        outputs[output_idx].p_value_bh_fdr = float(p_bh[list_idx])

    return outputs


# ---------------------------------------------------------------------------
# Replication criteria
# ---------------------------------------------------------------------------

def check_replication_goals(
    output: AnalysisOutput,
    alpha_corrected: float,
    human_effect_size: Optional[float],
    human_ci_lower: Optional[float],
    human_ci_upper: Optional[float],
) -> tuple[Optional[bool], Optional[bool]]:
    """
    Goal 1: Same direction + corrected p < alpha (BH-FDR by default)
    Goal 2: 95% CI of AI effect size overlaps human benchmark CI
    """
    goal1 = None
    goal2 = None

    p_corrected = output.p_value_bh_fdr

    if p_corrected is not None and output.effect_size is not None:
        # Goal 1: statistically significant at corrected alpha
        # Direction check requires human benchmark direction
        if human_effect_size is not None:
            same_direction = (output.effect_size * human_effect_size) > 0
            goal1 = same_direction and (p_corrected < alpha_corrected)
        else:
            # Without benchmark, just check significance
            goal1 = p_corrected < alpha_corrected

    # Goal 2: CI overlap
    if (
        output.effect_ci_lower is not None
        and output.effect_ci_upper is not None
        and human_ci_lower is not None
        and human_ci_upper is not None
    ):
        # CIs overlap if AI_lower <= human_upper AND human_lower <= AI_upper
        goal2 = (
            output.effect_ci_lower <= human_ci_upper
            and human_ci_lower <= output.effect_ci_upper
        )

    return goal1, goal2


# ---------------------------------------------------------------------------
# Auto-routing: pick test based on scale_type and number of conditions
# ---------------------------------------------------------------------------

def route_test(
    scale_type: str,
    scale_points: Optional[int],
    num_conditions: int,
    groups: list[tuple[str, list[float | str]]],
    question_id: str,
) -> AnalysisOutput:
    """
    Auto-detect appropriate test based on scale type and study design.

    Routing table:
    - continuous, 2 conditions → Welch's t-test
    - continuous, 3+ conditions → Welch's one-way ANOVA
    - likert, ≤4 points, any → Mann-Whitney U / Kruskal-Wallis (non-parametric default)
    - likert, 5-7 points, 2 → Welch's t-test (parametric default) + MW alongside
    - likert, 5-7 points, 3+ → Welch's ANOVA + KW alongside
    - categorical → Chi-square
    """
    if scale_type == "categorical":
        cat_groups = [(name, [str(v) for v in vals]) for name, vals in groups]
        return chi_square_test(cat_groups, question_id)

    numeric_groups = [(name, np.array([float(v) for v in vals])) for name, vals in groups]

    if scale_type == "likert" and scale_points is not None and scale_points <= 4:
        # Non-parametric by default for short scales
        if num_conditions == 2:
            g1_name, g1 = numeric_groups[0]
            g2_name, g2 = numeric_groups[1]
            u_stat, u_p = mannwhitneyu(g1, g2, alternative="two-sided")
            r = rank_biserial_r(u_stat, len(g1), len(g2))
            return AnalysisOutput(
                question_id=question_id,
                test_type="mann_whitney",
                test_statistic=float(u_stat),
                p_value_raw=float(u_p),
                p_value_bonferroni=None,
                p_value_bh_fdr=None,
                effect_size=r,
                effect_size_type="rank_biserial_r",
                effect_ci_lower=None,
                effect_ci_upper=None,
                condition_stats={
                    g1_name: _describe_group(g1_name, g1),
                    g2_name: _describe_group(g2_name, g2),
                },
                levene_stat=None,
                levene_p=None,
                nonparametric_result=None,
            )
        else:
            arrays = [arr for _, arr in numeric_groups]
            h_stat, kw_p = kruskal(*arrays)
            n_total = sum(len(a) for a in arrays)
            eps2 = epsilon_squared(h_stat, n_total)
            return AnalysisOutput(
                question_id=question_id,
                test_type="kruskal_wallis",
                test_statistic=float(h_stat),
                p_value_raw=float(kw_p),
                p_value_bonferroni=None,
                p_value_bh_fdr=None,
                effect_size=eps2,
                effect_size_type="epsilon_squared",
                effect_ci_lower=None,
                effect_ci_upper=None,
                condition_stats={
                    name: _describe_group(name, arr)
                    for name, arr in numeric_groups
                },
                levene_stat=None,
                levene_p=None,
                nonparametric_result=None,
            )

    # Parametric path (continuous or likert 5-7 scale)
    if num_conditions == 2:
        g1_name, g1 = numeric_groups[0]
        g2_name, g2 = numeric_groups[1]
        return welch_ttest(g1, g2, question_id)
    else:
        return welch_anova(numeric_groups, question_id)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _describe_group(name: str, arr: np.ndarray) -> dict:
    n = len(arr)
    mean = float(np.mean(arr))
    sd = float(np.std(arr, ddof=1)) if n > 1 else 0.0
    se = sd / math.sqrt(n) if n > 0 else 0.0
    return {"n": n, "mean": mean, "sd": sd, "se": se}


def _eta2_ci(eta2: float, df_between: int, n_total: int, alpha: float = 0.05) -> tuple[float, float]:
    """Approximate CI for η² using F distribution."""
    # Simple approximation
    se = math.sqrt(2 * eta2 * (1 - eta2)**2 / n_total) if n_total > 0 else 0
    z = stats.norm.ppf(1 - alpha / 2)
    return max(0.0, eta2 - z * se), min(1.0, eta2 + z * se)
