"""
Statistical analysis validation tests.

These tests compare outputs against known R reference values to ensure
fidelity before beta launch (per the spec's pre-beta gate requirement).

R reference values verified with Python/scipy (ground truth):
  t.test(x, y, var.equal=FALSE)         → t=6.9714, df=10.3448, p=0.000032, d=3.7264
  oneway.test(value~group,var.equal=F)   → F=61.5385, df=(2,8), p=0.0000139
  chisq.test(table, correct=TRUE)        → X²=0.4464 (Yates), p=0.504
  wilcox.test(x, y)                     → Mann-Whitney U

Note: welch_anova uses the Welch F-test (var.equal=FALSE equivalent), not
standard f_oneway. The chi-square uses Yates' correction (scipy default for 2x2).
"""

import math
import numpy as np
import pandas as pd
import pytest

from app.services.statistics import (
    welch_ttest,
    welch_anova,
    two_way_anova,
    ancova,
    chi_square_test,
    apply_multiple_comparison_corrections,
    check_replication_goals,
    cohens_d,
    route_test,
    rank_biserial_r,
    epsilon_squared,
)


# Python/scipy reference: ttest_ind([3,4,5,3,4,5,4], [1,2,1,2,1,2,1], equal_var=False)
# t = 6.9714, df = 10.3448, p = 0.000032, Cohen's d = 3.7264
class TestWelchTTest:
    g1 = np.array([3, 4, 5, 3, 4, 5, 4], dtype=float)
    g2 = np.array([1, 2, 1, 2, 1, 2, 1], dtype=float)

    def test_t_statistic_sign(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert result.test_statistic > 0  # g1 mean > g2 mean

    def test_t_statistic_exact(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert abs(result.test_statistic - 6.9714) < 0.001  # scipy reference

    def test_p_value_significant(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert result.p_value_raw < 0.01

    def test_p_value_exact(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert abs(result.p_value_raw - 0.000032) < 0.000005

    def test_df_exact(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert abs(result.df - 10.3448) < 0.001

    def test_effect_size_type(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert result.effect_size_type == "cohens_d"
        assert result.effect_size > 1.5  # large effect

    def test_cohens_d_exact(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert abs(result.effect_size - 3.7264) < 0.001  # pooled SD formula

    def test_levene_computed(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert result.levene_stat is not None
        assert result.levene_p is not None

    def test_nonparametric_companion(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert result.nonparametric_result is not None
        assert result.nonparametric_result["test"] == "mann_whitney_u"
        assert result.nonparametric_result["p_value"] < 0.05

    def test_ci_contains_true_d(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert result.effect_ci_lower < result.effect_size < result.effect_ci_upper


class TestWelchAnova:
    g1 = ("A", np.array([1, 2, 1, 2, 1], dtype=float))
    g2 = ("B", np.array([3, 4, 3, 4, 3], dtype=float))
    g3 = ("C", np.array([5, 6, 5, 6, 5], dtype=float))

    def test_f_statistic_positive(self):
        result = welch_anova([self.g1, self.g2, self.g3], "q1")
        assert result.test_statistic > 0

    def test_f_statistic_exact(self):
        # R: oneway.test(value~group,var.equal=FALSE) → F=61.5385, df=(2,8), p=0.0000139
        result = welch_anova([self.g1, self.g2, self.g3], "q1")
        assert abs(result.test_statistic - 61.5385) < 0.1

    def test_p_value_significant(self):
        result = welch_anova([self.g1, self.g2, self.g3], "q1")
        assert result.p_value_raw < 0.001

    def test_df2_exact(self):
        result = welch_anova([self.g1, self.g2, self.g3], "q1")
        assert abs(result.df - 8.0) < 0.1  # Welch df2 = 8 for equal-variance groups

    def test_eta2_between_0_and_1(self):
        result = welch_anova([self.g1, self.g2, self.g3], "q1")
        assert 0 <= result.effect_size <= 1
        assert result.effect_size_type == "eta2"

    def test_kruskal_wallis_companion(self):
        result = welch_anova([self.g1, self.g2, self.g3], "q1")
        assert result.nonparametric_result is not None
        assert result.nonparametric_result["test"] == "kruskal_wallis"

    def test_condition_stats_present(self):
        result = welch_anova([self.g1, self.g2, self.g3], "q1")
        assert "A" in result.condition_stats
        assert "B" in result.condition_stats
        assert "C" in result.condition_stats
        assert result.condition_stats["A"]["n"] == 5


class TestChiSquare:
    # Table built (sorted categories: no, yes): [[20,10],[40,30]]
    # scipy chi2_contingency with Yates correction: X²=0.4464, p=0.504, V=0.0668
    groups = [
        ("A", ["yes"] * 10 + ["no"] * 20),
        ("B", ["yes"] * 30 + ["no"] * 40),
    ]

    def test_chi2_positive(self):
        result = chi_square_test(self.groups, "q1")
        assert result.test_statistic > 0

    def test_effect_size_cramers_v(self):
        result = chi_square_test(self.groups, "q1")
        assert result.effect_size_type == "cramers_v"
        assert 0 <= result.effect_size <= 1


class TestMultipleComparisonCorrections:
    def test_bonferroni_applied(self):
        from app.services.statistics import AnalysisOutput
        outputs = [
            AnalysisOutput("q1", "welch_t", 2.0, 0.05, None, None, 0.5, "cohens_d",
                           0.2, 0.8, {}, None, None, None),
            AnalysisOutput("q2", "welch_t", 3.0, 0.01, None, None, 0.8, "cohens_d",
                           0.5, 1.1, {}, None, None, None),
        ]
        corrected = apply_multiple_comparison_corrections(outputs)
        # Bonferroni: multiply by n = 2
        assert abs(corrected[0].p_value_bonferroni - 0.1) < 1e-6
        assert abs(corrected[1].p_value_bonferroni - 0.02) < 1e-6

    def test_bh_fdr_applied(self):
        from app.services.statistics import AnalysisOutput
        outputs = [
            AnalysisOutput("q1", "welch_t", 2.0, 0.05, None, None, 0.5, "cohens_d",
                           0.2, 0.8, {}, None, None, None),
            AnalysisOutput("q2", "welch_t", 3.0, 0.01, None, None, 0.8, "cohens_d",
                           0.5, 1.1, {}, None, None, None),
        ]
        corrected = apply_multiple_comparison_corrections(outputs)
        # BH-FDR should be ≤ Bonferroni
        for o in corrected:
            assert o.p_value_bh_fdr <= o.p_value_bonferroni


class TestReplicationGoals:
    def test_goal1_true_when_significant_and_same_direction(self):
        from app.services.statistics import AnalysisOutput
        output = AnalysisOutput("q1", "welch_t", 3.0, 0.04, 0.04, 0.03,
                                0.5, "cohens_d", 0.2, 0.8, {}, None, None, None)
        goal1, goal2 = check_replication_goals(output, 0.05, 0.6, None, None)
        assert goal1 is True

    def test_goal1_false_when_opposite_direction(self):
        from app.services.statistics import AnalysisOutput
        output = AnalysisOutput("q1", "welch_t", -3.0, 0.04, 0.04, 0.03,
                                -0.5, "cohens_d", -0.8, -0.2, {}, None, None, None)
        goal1, goal2 = check_replication_goals(output, 0.05, 0.6, None, None)
        # human_effect_size=0.6 (positive), AI=-0.5 (negative) → different direction
        assert goal1 is False

    def test_goal2_true_when_ci_overlap(self):
        from app.services.statistics import AnalysisOutput
        # AI CI: [0.3, 0.7], Human CI: [0.5, 0.9] → overlap at [0.5, 0.7]
        output = AnalysisOutput("q1", "welch_t", 3.0, 0.04, 0.04, 0.03,
                                0.5, "cohens_d", 0.3, 0.7, {}, None, None, None)
        _, goal2 = check_replication_goals(output, 0.05, None, 0.5, 0.9)
        assert goal2 is True

    def test_goal2_false_when_no_ci_overlap(self):
        from app.services.statistics import AnalysisOutput
        # AI CI: [0.1, 0.3], Human CI: [0.5, 0.9] → no overlap
        output = AnalysisOutput("q1", "welch_t", 2.0, 0.04, 0.04, 0.03,
                                0.2, "cohens_d", 0.1, 0.3, {}, None, None, None)
        _, goal2 = check_replication_goals(output, 0.05, None, 0.5, 0.9)
        assert goal2 is False


class TestRouting:
    def test_categorical_routes_to_chi_square(self):
        groups = [("A", ["yes", "no", "yes"]), ("B", ["no", "no", "yes"])]
        result = route_test("categorical", None, 2, groups, "q1")
        assert result.test_type == "chi_square"

    def test_likert_4pt_routes_to_mann_whitney(self):
        groups = [("A", [1.0, 2.0, 1.0, 2.0, 3.0]), ("B", [3.0, 4.0, 4.0, 3.0, 4.0])]
        result = route_test("likert", 4, 2, groups, "q1")
        assert result.test_type == "mann_whitney"

    def test_likert_7pt_routes_to_welch_t(self):
        groups = [("A", [3.0, 4.0, 3.0, 5.0, 4.0]), ("B", [5.0, 6.0, 7.0, 5.0, 6.0])]
        result = route_test("likert", 7, 2, groups, "q1")
        assert result.test_type == "welch_t"

    def test_continuous_2groups_routes_to_welch_t(self):
        groups = [("A", [1.0, 2.0, 3.0]), ("B", [4.0, 5.0, 6.0])]
        result = route_test("continuous", None, 2, groups, "q1")
        assert result.test_type == "welch_t"

    def test_continuous_3groups_routes_to_anova(self):
        groups = [("A", [1.0, 2.0]), ("B", [3.0, 4.0]), ("C", [5.0, 6.0])]
        result = route_test("continuous", None, 3, groups, "q1")
        assert result.test_type == "welch_anova"

    def test_factorial_design_routes_to_two_way_anova(self):
        data = pd.DataFrame({
            "treat": ["a1"]*6 + ["a2"]*6,
            "site": ["b1"]*3 + ["b2"]*3 + ["b1"]*3 + ["b2"]*3,
            "score": [2.0,3,4, 4,5,6, 4,5,6, 2,3,4],
        })
        groups = [("a1_b1", [2.0,3,4]), ("a1_b2", [4,5,6]), ("a2_b1", [4,5,6]), ("a2_b2", [2,3,4])]
        result = route_test(
            "continuous", None, 4, groups, "q1",
            study_design="two_way_anova",
            factor_a_col="treat",
            factor_b_col="site",
            outcome_col="score",
            full_data=data,
        )
        assert result.test_type == "two_way_anova"

    def test_ancova_routes_correctly(self):
        data = pd.DataFrame({
            "treat": ["a","a","a","a","b","b","b","b"],
            "age": [20.0, 25.0, 30.0, 35.0, 20.0, 25.0, 30.0, 35.0],
            "score": [5.0, 7.0, 9.0, 11.0, 8.1, 10.2, 12.1, 13.9],
        })
        groups = [("a", [5.0,7,9,11]), ("b", [8.1,10.2,12.1,13.9])]
        result = route_test(
            "continuous", None, 2, groups, "q1",
            study_design="ancova",
            factor_a_col="treat",
            outcome_col="score",
            covariate_cols=["age"],
            full_data=data,
        )
        assert result.test_type == "ancova"


# ---------------------------------------------------------------------------
# R reference validation for Two-way ANOVA (spec Section 7.3)
# Dataset: pure crossover interaction (n=3 per cell, balanced 2x2)
#
# R equivalent:
#   library(car)
#   data <- data.frame(
#     treat=c("a1","a1","a1","a1","a1","a1","a2","a2","a2","a2","a2","a2"),
#     site =c("b1","b1","b1","b2","b2","b2","b1","b1","b1","b2","b2","b2"),
#     score=c(2,3,4,4,5,6,4,5,6,2,3,4))
#   Anova(lm(score ~ treat * site, data=data), type=2)
#
# Expected (verified by hand and scipy):
#   F(treat) = 0, p = 1.0, partial_eta2 = 0.0
#   F(site)  = 0, p = 1.0, partial_eta2 = 0.0
#   F(treat:site) = 12.0, p ≈ 0.00829, partial_eta2 = 0.6
# ---------------------------------------------------------------------------
class TestTwoWayAnova:
    data = pd.DataFrame({
        "treat": ["a1"]*6 + ["a2"]*6,
        "site":  ["b1"]*3 + ["b2"]*3 + ["b1"]*3 + ["b2"]*3,
        "score": [2.0,3,4, 4,5,6, 4,5,6, 2,3,4],
    })

    def test_test_type(self):
        result = two_way_anova(self.data, "score", "treat", "site", "q1")
        assert result.test_type == "two_way_anova"

    def test_primary_stat_is_interaction(self):
        # test_statistic and p_value_raw are for the interaction term
        result = two_way_anova(self.data, "score", "treat", "site", "q1")
        assert abs(result.test_statistic - 12.0) < 0.01  # R: F(treat:site)=12
        assert result.p_value_raw < 0.01                  # R: p≈0.00829

    def test_interaction_p_value_exact(self):
        result = two_way_anova(self.data, "score", "treat", "site", "q1")
        assert abs(result.p_value_raw - 0.00829) < 0.0005

    def test_interaction_partial_eta2_exact(self):
        # partial_eta2 = SS_ab / (SS_ab + SS_error) = 12 / (12+8) = 0.6
        result = two_way_anova(self.data, "score", "treat", "site", "q1")
        assert abs(result.effect_size - 0.6) < 1e-9

    def test_effect_size_type(self):
        result = two_way_anova(self.data, "score", "treat", "site", "q1")
        assert result.effect_size_type == "partial_eta2"

    def test_main_effects_zero_for_crossover(self):
        # Symmetrical crossover → no main effects
        result = two_way_anova(self.data, "score", "treat", "site", "q1")
        fx = result.nonparametric_result
        assert abs(fx["factor_a"]["f_statistic"]) < 1e-6
        assert abs(fx["factor_b"]["f_statistic"]) < 1e-6

    def test_partial_eta2_per_factor_in_results(self):
        result = two_way_anova(self.data, "score", "treat", "site", "q1")
        fx = result.nonparametric_result
        assert "factor_a" in fx
        assert "factor_b" in fx
        assert "interaction" in fx
        for key in ("factor_a", "factor_b", "interaction"):
            assert 0.0 <= fx[key]["partial_eta2"] <= 1.0

    def test_factor_names_preserved(self):
        result = two_way_anova(self.data, "score", "treat", "site", "q1")
        fx = result.nonparametric_result
        assert fx["factor_a"]["name"] == "treat"
        assert fx["factor_b"]["name"] == "site"
        assert fx["interaction"]["name"] == "treat:site"

    def test_condition_stats_has_cell_entries(self):
        result = two_way_anova(self.data, "score", "treat", "site", "q1")
        assert len(result.condition_stats) == 4
        for cell_key, stats in result.condition_stats.items():
            assert stats["n"] == 3

    def test_main_effect_significant_in_second_dataset(self):
        # Strong main effect of A, no interaction
        data2 = pd.DataFrame({
            "treat": ["a1"]*6 + ["a2"]*6,
            "site":  ["b1"]*3 + ["b2"]*3 + ["b1"]*3 + ["b2"]*3,
            "score": [1.0,2,3, 2,3,4, 5,6,7, 6,7,8],
        })
        result = two_way_anova(data2, "score", "treat", "site", "q1")
        fx = result.nonparametric_result
        # R: F(treat) = 48, p very small, partial_eta2 ≈ 0.857
        assert fx["factor_a"]["f_statistic"] > 40
        assert fx["factor_a"]["p_value"] < 0.001
        assert abs(fx["factor_a"]["partial_eta2"] - 0.857) < 0.01
        # No interaction
        assert abs(fx["interaction"]["f_statistic"]) < 1e-6


# ---------------------------------------------------------------------------
# R reference validation for ANCOVA (spec Section 7.3)
# Dataset: two groups, one continuous covariate (age)
#
# R equivalent:
#   data <- data.frame(
#     treat=c("a","a","a","a","b","b","b","b"),
#     age  =c(20,25,30,35,20,25,30,35),
#     score=c(5,7,9,11,8,10,12,14))
#   Anova(lm(score ~ treat + age, data=data), type=2)
#
# Expected: treat significant after controlling for age;
#           age highly significant; partial_eta2(treat) ≈ 1 (constant offset)
# ---------------------------------------------------------------------------
class TestAncova:
    data = pd.DataFrame({
        "treat": ["a","a","a","a","b","b","b","b"],
        "age":   [20.0, 25.0, 30.0, 35.0, 20.0, 25.0, 30.0, 35.0],
        "score": [5.0,  7.0,  9.0,  11.0,  8.0,  10.0, 12.0, 14.0],
    })

    def test_test_type(self):
        result = ancova(self.data, "score", "treat", ["age"], "q1")
        assert result.test_type == "ancova"

    def test_effect_size_type(self):
        result = ancova(self.data, "score", "treat", ["age"], "q1")
        assert result.effect_size_type == "partial_eta2"

    def test_factor_significant_after_covariate(self):
        # Treat adds a constant +3 offset independent of age → should be significant
        result = ancova(self.data, "score", "treat", ["age"], "q1")
        assert result.p_value_raw < 0.05

    def test_partial_eta2_between_0_and_1(self):
        result = ancova(self.data, "score", "treat", ["age"], "q1")
        assert 0.0 <= result.effect_size <= 1.0

    def test_nonparametric_result_structure(self):
        result = ancova(self.data, "score", "treat", ["age"], "q1")
        fx = result.nonparametric_result
        assert "factor" in fx
        assert "covariates" in fx
        assert fx["factor"]["name"] == "treat"
        assert len(fx["covariates"]) == 1
        assert fx["covariates"][0]["name"] == "age"

    def test_covariate_partial_eta2_between_0_and_1(self):
        result = ancova(self.data, "score", "treat", ["age"], "q1")
        age_peta2 = result.nonparametric_result["covariates"][0]["partial_eta2"]
        assert 0.0 <= age_peta2 <= 1.0

    def test_condition_stats_per_factor_level(self):
        result = ancova(self.data, "score", "treat", ["age"], "q1")
        assert "a" in result.condition_stats
        assert "b" in result.condition_stats
        assert result.condition_stats["a"]["n"] == 4

    def test_multiple_covariates(self):
        data2 = pd.DataFrame({
            "treat": ["a","a","a","a","b","b","b","b"],
            "age":   [20.0, 25.0, 30.0, 35.0, 22.0, 27.0, 32.0, 37.0],
            "iq":    [100.0, 105.0, 110.0, 115.0, 102.0, 107.0, 112.0, 117.0],
            "score": [5.1, 7.0, 8.9, 10.8, 8.2, 10.1, 12.0, 13.9],
        })
        result = ancova(data2, "score", "treat", ["age", "iq"], "q1")
        assert result.test_type == "ancova"
        fx = result.nonparametric_result
        assert len(fx["covariates"]) == 2
        assert fx["covariates"][0]["name"] == "age"
        assert fx["covariates"][1]["name"] == "iq"

    def test_exact_values_non_degenerate(self):
        # Non-degenerate fixture with real residual variance — pins exact F values.
        # Python/statsmodels reference (Anova type=2):
        #   F(treat)=29.5281, p=0.000972, partial_eta2=0.8084
        #   F(age)=0.0161, p=0.9027, df_error=7
        data_nd = pd.DataFrame({
            "treat":   ["A","A","A","A","A","B","B","B","B","B"],
            "age":     [25.0, 30.0, 28.0, 22.0, 35.0, 24.0, 32.0, 27.0, 21.0, 33.0],
            "outcome": [8.0,  7.0,  9.0,  6.0,  8.0,  3.0,  4.0,  2.0,  5.0,  3.0],
        })
        result = ancova(data_nd, "outcome", "treat", ["age"], "q1")
        assert abs(result.test_statistic - 29.5281) < 0.01
        assert abs(result.p_value_raw - 0.000972) < 0.0001
        assert abs(result.effect_size - 0.8084) < 0.001
        assert abs(result.df - 7.0) < 0.01
        age_r = result.nonparametric_result["covariates"][0]
        assert abs(age_r["f_statistic"] - 0.0161) < 0.001
        assert age_r["p_value"] > 0.5


# ---------------------------------------------------------------------------
# Regression tests for Bug #1 and Bug #2 (JIN-149 methodology audit)
# ---------------------------------------------------------------------------

class TestRankBiserialRRegression:
    """Regression tests for Bug #1: rank_biserial_r sign was reversed.

    The formula was: 1 - (2*U)/(n1*n2)  [wrong — inverts sign]
    Fixed to:        (2*U)/(n1*n2) - 1  [correct per Kerby 2014]
    """

    def test_positive_one_when_group1_completely_dominates(self):
        # group1=[5,6,7] vs group2=[1,2,3]: every g1 value > every g2 value
        # → U(g1) = n1*n2 = 9, so r = (2*9)/(3*3) - 1 = +1.0
        r = rank_biserial_r(u_stat=9.0, n1=3, n2=3)
        assert abs(r - 1.0) < 1e-9, f"Expected +1.0, got {r} (sign is likely inverted)"

    def test_negative_one_when_group2_completely_dominates(self):
        # group1=[1,2,3] vs group2=[5,6,7]: every g2 value > every g1 value
        # → U(g1) = 0, so r = (2*0)/(3*3) - 1 = -1.0
        r = rank_biserial_r(u_stat=0.0, n1=3, n2=3)
        assert abs(r - (-1.0)) < 1e-9, f"Expected -1.0, got {r}"

    def test_zero_when_no_difference(self):
        # U = n1*n2/2 → r = 0.0 (tied ranks / no difference)
        r = rank_biserial_r(u_stat=4.5, n1=3, n2=3)
        assert abs(r) < 1e-9, f"Expected 0.0, got {r}"

    def test_range_is_minus_one_to_plus_one(self):
        for u in [0.0, 2.25, 4.5, 6.75, 9.0]:
            r = rank_biserial_r(u_stat=u, n1=3, n2=3)
            assert -1.0 <= r <= 1.0, f"r={r} is outside [-1, 1] for U={u}"

    def test_positive_r_matches_mannwhitneyu_empirical(self):
        # Verify against scipy: group1=[5,6,7], group2=[1,2,3]
        from scipy.stats import mannwhitneyu
        g1 = np.array([5.0, 6.0, 7.0])
        g2 = np.array([1.0, 2.0, 3.0])
        u_stat, _ = mannwhitneyu(g1, g2, alternative="two-sided")
        r = rank_biserial_r(u_stat=u_stat, n1=len(g1), n2=len(g2))
        assert r > 0, f"Expected r > 0 (group1 higher), got r={r}"
        assert abs(r - 1.0) < 1e-9, f"Expected r=+1.0, got r={r}"


class TestEpsilonSquaredRegression:
    """Regression tests for Bug #2: epsilon_squared missing k parameter.

    The formula was: (H - 1) / (N - 1)       [wrong for k > 2]
    Fixed to:        (H - (k-1)) / (N - 1)   [Tomczak & Tomczak 2014]
    """

    def test_three_groups_correct_value(self):
        # H=12.84, k=3, N=15 → (12.84 - 2) / 14 = 10.84/14 ≈ 0.7743
        eps2 = epsilon_squared(h_stat=12.84, n_total=15, k=3)
        assert abs(eps2 - 0.7743) < 0.001, f"Expected ≈0.7743, got {eps2}"

    def test_three_groups_not_old_wrong_value(self):
        # Old formula (H-1)/(N-1) = 11.84/14 ≈ 0.8457 — must NOT match
        eps2 = epsilon_squared(h_stat=12.84, n_total=15, k=3)
        assert abs(eps2 - 0.8457) > 0.05, f"Value {eps2} matches old wrong formula"

    def test_two_groups_unchanged(self):
        # k=2: (H - 1)/(N-1) — old and new formulas agree for 2 groups
        eps2 = epsilon_squared(h_stat=5.0, n_total=10, k=2)
        expected = (5.0 - 1) / (10 - 1)
        assert abs(eps2 - expected) < 1e-9

    def test_five_groups_correct_value(self):
        # k=5, H=20.0, N=25 → (20 - 4) / 24 = 16/24 ≈ 0.6667
        eps2 = epsilon_squared(h_stat=20.0, n_total=25, k=5)
        assert abs(eps2 - (16 / 24)) < 1e-9

    def test_default_k_is_two_for_backwards_compat(self):
        # If k omitted, default=2 should match old 2-group behaviour
        eps2_default = epsilon_squared(h_stat=8.0, n_total=20)
        eps2_k2 = epsilon_squared(h_stat=8.0, n_total=20, k=2)
        assert abs(eps2_default - eps2_k2) < 1e-9

    def test_zero_for_small_n(self):
        eps2 = epsilon_squared(h_stat=2.0, n_total=1, k=2)
        assert eps2 == 0.0
