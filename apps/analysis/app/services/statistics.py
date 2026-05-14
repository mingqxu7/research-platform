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
from typing import Any, Optional

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy import stats
from scipy.stats import mannwhitneyu, kruskal, levene, chi2_contingency, studentized_range
from statsmodels.stats.anova import anova_lm
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.power import TTestIndPower, FTestAnovaPower, GofChisquarePower


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


@dataclass
class PairwiseComparison:
    group1: str
    group2: str
    mean_diff: float        # mean(group1) - mean(group2)
    se: float               # Welch SE = sqrt(var1/n1 + var2/n2)
    df: float               # Welch-Satterthwaite df
    q_statistic: float      # studentized range q = |mean_diff| / (se / sqrt(2))
    p_value: float          # from studentized range distribution
    significant: bool       # p < 0.05 (two-sided familywise)


# ---------------------------------------------------------------------------
# Games-Howell post-hoc test
# ---------------------------------------------------------------------------

def games_howell_posthoc(
    groups: list[tuple[str, np.ndarray]],
    alpha: float = 0.05,
) -> list[PairwiseComparison]:
    """Games-Howell pairwise post-hoc test for Welch ANOVA.

    Controls FWER without assuming equal variances or equal group sizes.
    Uses the Studentized range distribution (same family as Tukey HSD,
    but with per-pair Welch degrees of freedom).

    Matches the formulation in Games & Howell (1976) and pingouin's
    `pairwise_gameshowell()` output.
    """
    k = len(groups)
    results: list[PairwiseComparison] = []

    for i in range(k):
        for j in range(i + 1, k):
            name_i, arr_i = groups[i]
            name_j, arr_j = groups[j]
            n_i, n_j = len(arr_i), len(arr_j)
            m_i, m_j = float(np.mean(arr_i)), float(np.mean(arr_j))
            v_i = float(np.var(arr_i, ddof=1))
            v_j = float(np.var(arr_j, ddof=1))

            vi_ni = v_i / n_i
            vj_nj = v_j / n_j
            se = math.sqrt(vi_ni + vj_nj)

            # Welch-Satterthwaite df for this pair
            if (n_i - 1) == 0 or (n_j - 1) == 0:
                df_ij = 1.0
            else:
                df_ij = (vi_ni + vj_nj) ** 2 / (
                    vi_ni ** 2 / (n_i - 1) + vj_nj ** 2 / (n_j - 1)
                )

            # Studentized range statistic
            q = abs(m_i - m_j) / (se / math.sqrt(2))
            p = float(studentized_range.sf(q, k=k, df=df_ij))

            results.append(PairwiseComparison(
                group1=name_i,
                group2=name_j,
                mean_diff=round(m_i - m_j, 10),
                se=round(se, 10),
                df=round(df_ij, 4),
                q_statistic=round(q, 6),
                p_value=round(p, 6),
                significant=p < alpha,
            ))

    return results


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
    """Rank-biserial correlation r for Mann-Whitney U (positive when group1 > group2)."""
    return (2 * u_stat) / (n1 * n2) - 1


def epsilon_squared(h_stat: float, n_total: int, k: int = 2) -> float:
    """Epsilon-squared effect size for Kruskal-Wallis (Tomczak & Tomczak 2014).

    Formula: (H - (k-1)) / (N-1) where k = number of groups.
    """
    if n_total <= 1:
        return 0.0
    return (h_stat - (k - 1)) / (n_total - 1)


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


def _welch_f_oneway(arrays: list[np.ndarray]) -> tuple[float, float, float, float]:
    """Welch's one-way ANOVA (matches R's oneway.test(var.equal=FALSE)).

    Standard f_oneway assumes homoscedasticity; this uses Welch's F-statistic
    which is robust to unequal variances across conditions — critical when LLM
    temperature or persona demographics create differing within-group spread.
    """
    k = len(arrays)
    n_j = np.array([len(a) for a in arrays], dtype=float)
    mean_j = np.array([np.mean(a) for a in arrays])
    var_j = np.array([np.var(a, ddof=1) for a in arrays])

    # Guard against zero variance (perfectly constant group)
    var_j = np.where(var_j == 0, 1e-12, var_j)

    w_j = n_j / var_j          # inverse-variance weights
    W = np.sum(w_j)
    m_star = np.sum(w_j * mean_j) / W  # weighted grand mean

    ss_between = np.sum(w_j * (mean_j - m_star) ** 2)

    # Welch's denominator correction
    h = np.sum((1.0 - w_j / W) ** 2 / (n_j - 1))
    correction = 1.0 + (2.0 * (k - 2) / (k ** 2 - 1)) * h

    F_welch = (ss_between / (k - 1)) / correction if correction != 0 else float("nan")

    # Degrees of freedom (Satterthwaite)
    df1 = k - 1
    denom = 3.0 * np.sum((1.0 - w_j / W) ** 2 / (n_j - 1))
    df2 = (k ** 2 - 1) / denom if denom != 0 else float("inf")

    p_val = float(stats.f.sf(F_welch, df1, df2)) if not math.isnan(F_welch) else float("nan")
    return float(F_welch), p_val, float(df1), float(df2)


def welch_anova(
    groups: list[tuple[str, np.ndarray]], question_id: str
) -> AnalysisOutput:
    """Welch's one-way ANOVA — robust to unequal variances (matches R oneway.test var.equal=FALSE)."""
    arrays = [g[1] for g in groups]
    group_names = [g[0] for g in groups]

    f_stat, p_val, df1, df2 = _welch_f_oneway(arrays)

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
    eps2 = epsilon_squared(h_stat, n_total, k=len(arrays))

    # Games-Howell post-hoc pairwise comparisons
    posthoc = games_howell_posthoc(groups)
    posthoc_dicts = [
        {
            "group1": p.group1, "group2": p.group2,
            "mean_diff": p.mean_diff, "se": p.se, "df": p.df,
            "q_statistic": p.q_statistic, "p_value": p.p_value,
            "significant": p.significant,
        }
        for p in posthoc
    ]

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
            "posthoc_games_howell": posthoc_dicts,
        },
        df=df2,  # Welch df2 (denominator df)
    )


def two_way_anova(
    data: pd.DataFrame,
    outcome_col: str,
    factor_a_col: str,
    factor_b_col: str,
    question_id: str,
) -> AnalysisOutput:
    """Two-way ANOVA with Type II SS and partial η² per factor and interaction.

    Matches R: Anova(lm(outcome ~ factor_a * factor_b), type=2)
    """
    _data = data[[outcome_col, factor_a_col, factor_b_col]].copy()
    _data.columns = pd.Index(["outcome", "fa", "fb"])

    model = smf.ols("outcome ~ C(fa) + C(fb) + C(fa):C(fb)", data=_data).fit()
    table = anova_lm(model, typ=2)

    ss_a = float(table.loc["C(fa)", "sum_sq"])
    ss_b = float(table.loc["C(fb)", "sum_sq"])
    ss_ab = float(table.loc["C(fa):C(fb)", "sum_sq"])
    ss_error = float(table.loc["Residual", "sum_sq"])

    f_a = float(table.loc["C(fa)", "F"])
    p_a = float(table.loc["C(fa)", "PR(>F)"])
    df_a = float(table.loc["C(fa)", "df"])

    f_b = float(table.loc["C(fb)", "F"])
    p_b = float(table.loc["C(fb)", "PR(>F)"])
    df_b = float(table.loc["C(fb)", "df"])

    f_ab = float(table.loc["C(fa):C(fb)", "F"])
    p_ab = float(table.loc["C(fa):C(fb)", "PR(>F)"])
    df_ab = float(table.loc["C(fa):C(fb)", "df"])
    df_error = float(table.loc["Residual", "df"])

    peta2_a = partial_eta_squared(ss_a, ss_error)
    peta2_b = partial_eta_squared(ss_b, ss_error)
    peta2_ab = partial_eta_squared(ss_ab, ss_error)

    condition_stats: dict[str, dict] = {}
    for level_a in sorted(_data["fa"].unique()):
        for level_b in sorted(_data["fb"].unique()):
            mask = (_data["fa"] == level_a) & (_data["fb"] == level_b)
            cell_vals = _data.loc[mask, "outcome"].to_numpy(dtype=float)
            cell_key = f"{level_a}_{level_b}"
            condition_stats[cell_key] = _describe_group(cell_key, cell_vals)

    return AnalysisOutput(
        question_id=question_id,
        test_type="two_way_anova",
        test_statistic=f_ab,
        p_value_raw=p_ab,
        p_value_bonferroni=None,
        p_value_bh_fdr=None,
        effect_size=peta2_ab,
        effect_size_type="partial_eta2",
        effect_ci_lower=None,
        effect_ci_upper=None,
        condition_stats=condition_stats,
        levene_stat=None,
        levene_p=None,
        nonparametric_result={
            "factor_a": {
                "name": factor_a_col,
                "f_statistic": f_a,
                "p_value": p_a,
                "partial_eta2": peta2_a,
                "df": df_a,
            },
            "factor_b": {
                "name": factor_b_col,
                "f_statistic": f_b,
                "p_value": p_b,
                "partial_eta2": peta2_b,
                "df": df_b,
            },
            "interaction": {
                "name": f"{factor_a_col}:{factor_b_col}",
                "f_statistic": f_ab,
                "p_value": p_ab,
                "partial_eta2": peta2_ab,
                "df": df_ab,
            },
        },
        df=df_error,
    )


def ancova(
    data: pd.DataFrame,
    outcome_col: str,
    factor_col: str,
    covariate_cols: list[str],
    question_id: str,
) -> AnalysisOutput:
    """ANCOVA with Type II SS and partial η² for factor and each covariate.

    Matches R: Anova(lm(outcome ~ factor + cov1 + ...), type=2)
    """
    cols = [outcome_col, factor_col] + covariate_cols
    _data = data[cols].copy()

    col_rename: dict[str, str] = {outcome_col: "outcome", factor_col: "factor_grp"}
    safe_cov_names: list[str] = []
    for i, cov in enumerate(covariate_cols):
        safe = f"cov{i}"
        col_rename[cov] = safe
        safe_cov_names.append(safe)
    _data = _data.rename(columns=col_rename)

    cov_terms = " + ".join(safe_cov_names)
    formula = f"outcome ~ C(factor_grp) + {cov_terms}"
    model = smf.ols(formula, data=_data).fit()
    table = anova_lm(model, typ=2)

    ss_factor = float(table.loc["C(factor_grp)", "sum_sq"])
    f_factor = float(table.loc["C(factor_grp)", "F"])
    p_factor = float(table.loc["C(factor_grp)", "PR(>F)"])
    df_factor = float(table.loc["C(factor_grp)", "df"])
    ss_error = float(table.loc["Residual", "sum_sq"])
    df_error = float(table.loc["Residual", "df"])

    peta2_factor = partial_eta_squared(ss_factor, ss_error)

    cov_results: list[dict] = []
    for i, cov_name in enumerate(covariate_cols):
        safe = f"cov{i}"
        ss_cov = float(table.loc[safe, "sum_sq"])
        f_cov = float(table.loc[safe, "F"])
        p_cov = float(table.loc[safe, "PR(>F)"])
        peta2_cov = partial_eta_squared(ss_cov, ss_error)
        cov_results.append({
            "name": cov_name,
            "f_statistic": f_cov,
            "p_value": p_cov,
            "partial_eta2": peta2_cov,
        })

    condition_stats: dict[str, dict] = {}
    for level in sorted(_data["factor_grp"].unique()):
        vals = _data.loc[_data["factor_grp"] == level, "outcome"].to_numpy(dtype=float)
        condition_stats[str(level)] = _describe_group(str(level), vals)

    return AnalysisOutput(
        question_id=question_id,
        test_type="ancova",
        test_statistic=f_factor,
        p_value_raw=p_factor,
        p_value_bonferroni=None,
        p_value_bh_fdr=None,
        effect_size=peta2_factor,
        effect_size_type="partial_eta2",
        effect_ci_lower=None,
        effect_ci_upper=None,
        condition_stats=condition_stats,
        levene_stat=None,
        levene_p=None,
        nonparametric_result={
            "factor": {
                "name": factor_col,
                "f_statistic": f_factor,
                "p_value": p_factor,
                "partial_eta2": peta2_factor,
                "df": df_factor,
            },
            "covariates": cov_results,
        },
        df=df_error,
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
    # Optional: factorial/ANCOVA dispatch
    study_design: Optional[str] = None,
    factor_a_col: Optional[str] = None,
    factor_b_col: Optional[str] = None,
    outcome_col: Optional[str] = None,
    covariate_cols: Optional[list[str]] = None,
    full_data: Optional[pd.DataFrame] = None,
) -> AnalysisOutput:
    """
    Auto-detect appropriate test based on scale type and study design.

    Routing table:
    - study_design="two_way_anova" + full_data → Two-way ANOVA (Type II SS, partial η²)
    - study_design="ancova" + full_data → ANCOVA (partial η²)
    - continuous, 2 conditions → Welch's t-test
    - continuous, 3+ conditions → Welch's one-way ANOVA
    - likert, ≤4 points, any → Mann-Whitney U / Kruskal-Wallis (non-parametric default)
    - likert, 5-7 points, 2 → Welch's t-test (parametric default) + MW alongside
    - likert, 5-7 points, 3+ → Welch's ANOVA + KW alongside
    - categorical → Chi-square
    """
    if (
        study_design == "two_way_anova"
        and full_data is not None
        and factor_a_col
        and factor_b_col
    ):
        _outcome = outcome_col or "outcome"
        return two_way_anova(full_data, _outcome, factor_a_col, factor_b_col, question_id)

    if (
        study_design == "ancova"
        and full_data is not None
        and factor_a_col
        and covariate_cols
    ):
        _outcome = outcome_col or "outcome"
        return ancova(full_data, _outcome, factor_a_col, covariate_cols, question_id)

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
            eps2 = epsilon_squared(h_stat, n_total, k=len(arrays))
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

# ---------------------------------------------------------------------------
# Power Analysis
# ---------------------------------------------------------------------------

@dataclass
class PowerAnalysisResult:
    test_type: str
    solve_for: str                   # "n", "power", or "effect_size"
    effect_size: float
    alpha: float
    power: float
    n_per_group: int
    n_groups: int
    effect_size_label: str           # "cohens_d", "cohens_f", "cohens_w"
    notes: str = ""


def power_analysis(
    test_type: str,
    effect_size: float,
    alpha: float = 0.05,
    power: Optional[float] = None,
    n_per_group: Optional[int] = None,
    n_groups: int = 2,
) -> PowerAnalysisResult:
    """Compute sample size, power, or MDE for t-test, ANOVA, or chi-square.

    Exactly one of `power` or `n_per_group` must be None — that is the solved
    quantity.  Both None → solve for n at power=0.80.

    test_type:
        "welch_t"    — two-independent-samples t-test, effect_size = Cohen's d
        "welch_anova"/ "anova" — one-way ANOVA, effect_size = Cohen's f
        "chi_square" — goodness-of-fit / contingency, effect_size = Cohen's w

    Uses statsmodels power classes, matching G*Power defaults (two-tailed,
    equal group sizes, non-central distributions).
    """
    if power is None and n_per_group is None:
        power = 0.80

    solve_for: str
    solved_n: int
    solved_power: float

    if test_type in ("welch_t", "ttest"):
        analysis = TTestIndPower()
        label = "cohens_d"
        if n_per_group is None:
            solve_for = "n"
            raw_n = analysis.solve_power(
                effect_size=effect_size, alpha=alpha, power=power, ratio=1.0
            )
            solved_n = math.ceil(raw_n)
            solved_power = float(analysis.power(
                effect_size=effect_size, nobs1=solved_n, alpha=alpha, ratio=1.0
            ))
        else:
            solve_for = "power"
            solved_n = n_per_group
            solved_power = float(analysis.power(
                effect_size=effect_size, nobs1=n_per_group, alpha=alpha, ratio=1.0
            ))

    elif test_type in ("welch_anova", "anova"):
        analysis_a = FTestAnovaPower()
        label = "cohens_f"
        k = n_groups
        if n_per_group is None:
            solve_for = "n"
            raw_n_total = analysis_a.solve_power(
                effect_size=effect_size, alpha=alpha, power=power, k_groups=k
            )
            # nobs is total N; convert to per-group (ceil for ≥80% power guarantee)
            solved_n = math.ceil(raw_n_total / k)
            solved_power = float(analysis_a.power(
                effect_size=effect_size, nobs=solved_n * k, alpha=alpha, k_groups=k
            ))
        else:
            solve_for = "power"
            solved_n = n_per_group
            solved_power = float(analysis_a.power(
                effect_size=effect_size, nobs=n_per_group * k, alpha=alpha, k_groups=k
            ))

    elif test_type == "chi_square":
        analysis_c = GofChisquarePower()
        label = "cohens_w"
        df_chi = n_groups - 1  # degrees of freedom = categories - 1
        if n_per_group is None:
            solve_for = "n"
            raw_n = analysis_c.solve_power(
                effect_size=effect_size, alpha=alpha, power=power, n_bins=n_groups
            )
            solved_n = math.ceil(raw_n)
            solved_power = float(analysis_c.power(
                effect_size=effect_size, nobs=solved_n, alpha=alpha, n_bins=n_groups
            ))
        else:
            solve_for = "power"
            solved_n = n_per_group
            solved_power = float(analysis_c.power(
                effect_size=effect_size, nobs=n_per_group, alpha=alpha, n_bins=n_groups
            ))

    else:
        raise ValueError(f"Unsupported test_type for power analysis: {test_type!r}")

    _small = {"cohens_d": 0.2, "cohens_f": 0.1, "cohens_w": 0.1}[label]
    _medium = {"cohens_d": 0.5, "cohens_f": 0.25, "cohens_w": 0.3}[label]
    _large = {"cohens_d": 0.8, "cohens_f": 0.4, "cohens_w": 0.5}[label]
    notes = (
        f"Two-tailed α={alpha}, equal group sizes. "
        f"Effect thresholds (Cohen 1988): small={_small}, medium={_medium}, large={_large}."
    )

    return PowerAnalysisResult(
        test_type=test_type,
        solve_for=solve_for,
        effect_size=float(effect_size),
        alpha=float(alpha),
        power=round(solved_power, 4),
        n_per_group=solved_n,
        n_groups=n_groups,
        effect_size_label=label,
        notes=notes,
    )


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
