/**
 * Persona Generator
 *
 * Samples demographic characteristics from study spec distributions,
 * then synthesizes a natural-language persona description for use as
 * the LLM system prompt identity layer.
 */

import type { DemographicSpec } from "../db/types";

export interface GeneratedDemographics {
  age: number;
  gender: string;
  income: string;
  education: string;
  occupation: string;
}

function sampleFromDistribution(distribution: Record<string, number>): string {
  const rand = Math.random();
  let cumulative = 0;
  for (const [key, prob] of Object.entries(distribution)) {
    cumulative += prob;
    if (rand <= cumulative) return key;
  }
  // fallback to last key
  return Object.keys(distribution)[Object.keys(distribution).length - 1];
}

function sampleAge(mean: number, sd: number): number {
  // Box-Muller transform for normal distribution
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  const age = Math.round(mean + sd * z);
  return Math.max(18, Math.min(80, age));
}

export function sampleDemographics(spec: DemographicSpec): GeneratedDemographics {
  const age = sampleAge(spec.age_mean, spec.age_sd);
  const gender = sampleFromDistribution(spec.gender_distribution);
  const income = sampleFromDistribution(spec.income_distribution);
  const education = sampleFromDistribution(spec.education_distribution);
  const occupation =
    spec.occupation_pool[Math.floor(Math.random() * spec.occupation_pool.length)];

  return { age, gender, income, education, occupation };
}

export function buildPersonaText(demographics: GeneratedDemographics): string {
  const { age, gender, income, education, occupation } = demographics;

  const genderPronoun =
    gender === "male" ? "man" : gender === "female" ? "woman" : "person";

  const educationMap: Record<string, string> = {
    high_school: "a high school diploma",
    some_college: "some college education",
    bachelors: "a bachelor's degree",
    masters: "a master's degree",
    doctorate: "a doctoral degree",
    vocational: "vocational training",
  };

  const incomeMap: Record<string, string> = {
    low: "under $30,000",
    lower_middle: "$30,000–$50,000",
    middle: "$50,000–$80,000",
    upper_middle: "$80,000–$120,000",
    high: "over $120,000",
  };

  const educationStr = educationMap[education] ?? education;
  const incomeStr = incomeMap[income] ?? income;

  return (
    `You are a ${age}-year-old ${genderPronoun} with ${educationStr}, ` +
    `working as a ${occupation}, with a household income of ${incomeStr}. ` +
    `You are a real person with your own views and preferences. ` +
    `Please answer the following questions based on your personal perspective.`
  );
}
