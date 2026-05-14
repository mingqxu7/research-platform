import { describe, it, expect } from "vitest";
import { buildPersonaText, sampleDemographics } from "./persona-generator";
import type { DemographicSpec } from "../db/types";

const STANDARD_SPEC: DemographicSpec = {
  age_mean: 40,
  age_sd: 10,
  gender_distribution: { male: 0.5, female: 0.5 },
  income_distribution: { low: 0.2, middle: 0.5, high: 0.3 },
  education_distribution: { bachelors: 0.6, masters: 0.4 },
  occupation_pool: ["teacher", "engineer", "nurse"],
};

describe("buildPersonaText", () => {
  it("uses 'man' for male gender", () => {
    const text = buildPersonaText({ age: 35, gender: "male", income: "middle", education: "bachelors", occupation: "engineer" });
    expect(text).toContain("35-year-old man");
  });

  it("uses 'woman' for female gender", () => {
    const text = buildPersonaText({ age: 28, gender: "female", income: "low", education: "high_school", occupation: "nurse" });
    expect(text).toContain("28-year-old woman");
  });

  it("uses 'person' for non-binary gender", () => {
    const text = buildPersonaText({ age: 30, gender: "non_binary", income: "middle", education: "masters", occupation: "teacher" });
    expect(text).toContain("30-year-old person");
  });

  it("maps known education keys to readable strings", () => {
    const cases: Array<[string, string]> = [
      ["high_school", "a high school diploma"],
      ["some_college", "some college education"],
      ["bachelors", "a bachelor's degree"],
      ["masters", "a master's degree"],
      ["doctorate", "a doctoral degree"],
      ["vocational", "vocational training"],
      // Legacy template key used by pre-existing study templates
      ["graduate", "a graduate degree"],
    ];
    for (const [key, label] of cases) {
      const text = buildPersonaText({ age: 30, gender: "male", income: "middle", education: key, occupation: "teacher" });
      expect(text).toContain(label);
    }
  });

  it("falls back to raw value for unknown education key", () => {
    const text = buildPersonaText({ age: 30, gender: "male", income: "middle", education: "phd_candidate", occupation: "teacher" });
    expect(text).toContain("phd_candidate");
  });

  it("maps known income keys to readable strings", () => {
    const cases: Array<[string, string]> = [
      ["low", "under $30,000"],
      ["lower_middle", "$30,000–$50,000"],
      ["middle", "$50,000–$80,000"],
      ["upper_middle", "$80,000–$120,000"],
      ["high", "over $120,000"],
      // Legacy template keys used by pre-existing study templates
      ["under_30k", "under $30,000"],
      ["30k_60k", "$30,000–$60,000"],
      ["60k_100k", "$60,000–$100,000"],
      ["over_100k", "over $100,000"],
    ];
    for (const [key, label] of cases) {
      const text = buildPersonaText({ age: 30, gender: "female", income: key, education: "bachelors", occupation: "engineer" });
      expect(text).toContain(label);
    }
  });

  it("falls back to raw value for unknown income key", () => {
    const text = buildPersonaText({ age: 30, gender: "male", income: "wealthy", education: "bachelors", occupation: "teacher" });
    expect(text).toContain("wealthy");
  });

  it("includes occupation in text", () => {
    const text = buildPersonaText({ age: 45, gender: "female", income: "high", education: "doctorate", occupation: "software engineer" });
    expect(text).toContain("software engineer");
  });

  it("ends with personal perspective instruction", () => {
    const text = buildPersonaText({ age: 30, gender: "male", income: "middle", education: "bachelors", occupation: "teacher" });
    expect(text).toContain("personal perspective");
  });
});

describe("sampleDemographics", () => {
  it("returns all required fields", () => {
    const result = sampleDemographics(STANDARD_SPEC);
    expect(result).toHaveProperty("age");
    expect(result).toHaveProperty("gender");
    expect(result).toHaveProperty("income");
    expect(result).toHaveProperty("education");
    expect(result).toHaveProperty("occupation");
  });

  it("clamps age to [18, 80] even with extreme sd", () => {
    const extremeSpec: DemographicSpec = { ...STANDARD_SPEC, age_mean: 50, age_sd: 100 };
    for (let i = 0; i < 50; i++) {
      const { age } = sampleDemographics(extremeSpec);
      expect(age).toBeGreaterThanOrEqual(18);
      expect(age).toBeLessThanOrEqual(80);
    }
  });

  it("samples occupation only from the pool", () => {
    for (let i = 0; i < 30; i++) {
      const { occupation } = sampleDemographics(STANDARD_SPEC);
      expect(STANDARD_SPEC.occupation_pool).toContain(occupation);
    }
  });

  it("samples gender only from distribution keys", () => {
    const keys = Object.keys(STANDARD_SPEC.gender_distribution);
    for (let i = 0; i < 30; i++) {
      const { gender } = sampleDemographics(STANDARD_SPEC);
      expect(keys).toContain(gender);
    }
  });

  it("samples education only from distribution keys", () => {
    const keys = Object.keys(STANDARD_SPEC.education_distribution);
    for (let i = 0; i < 30; i++) {
      const { education } = sampleDemographics(STANDARD_SPEC);
      expect(keys).toContain(education);
    }
  });

  it("returns integer age", () => {
    const { age } = sampleDemographics(STANDARD_SPEC);
    expect(Number.isInteger(age)).toBe(true);
  });

  it("respects deterministic single-value distribution", () => {
    const spec: DemographicSpec = {
      ...STANDARD_SPEC,
      gender_distribution: { female: 1.0 },
    };
    for (let i = 0; i < 10; i++) {
      expect(sampleDemographics(spec).gender).toBe("female");
    }
  });
});
