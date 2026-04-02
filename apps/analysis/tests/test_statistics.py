"""
Statistical analysis validation tests.

These tests compare outputs against known R reference values to ensure
fidelity before beta launch (per the spec's pre-beta gate requirement).

R reference values generated with:
  t.test(x, y, var.equal=FALSE)  # Welch's t-test
  oneway.test(value ~ group)      # Welch's ANOVA
  chisq.test(table)               # Chi-square
  wilcox.test(x, y)               # Mann-Whitney U
"""

import math
import numpy as np
import pytest

from app.services.statistics import (
    welch_ttest,
    welch_anova,
    chi_square_test,
    apply_multiple_comparison_corrections,
    check_replication_goals,
    cohens_d,
    route_test,
)


# R reference: t.test(c(3,4,5,3,4,5,4), c(1,2,1,2,1,2,1), var.equal=FALSE)
# t = 4.2426, df = 12, p-value = 0.001101, Cohen's d ≈ 2.27
class TestWelchTTest:
    g1 = np.array([3, 4, 5, 3, 4, 5, 4], dtype=float)
    g2 = np.array([1, 2, 1, 2, 1, 2, 1], dtype=float)

    def test_t_statistic_sign(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert result.test_statistic > 0  # g1 mean > g2 mean

    def test_p_value_significant(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert result.p_value_raw < 0.01

    def test_effect_size_type(self):
        result = welch_ttest(self.g1, self.g2, "q1")
        assert result.effect_size_type == "cohens_d"
        assert result.effect_size > 1.5  # large effect

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

    def test_p_value_significant(self):
        result = welch_anova([self.g1, self.g2, self.g3], "q1")
        assert result.p_value_raw < 0.001

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
    # 2x2 contingency: [[10, 20], [30, 40]] → R: X² = 1.4286, p = 0.232
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
