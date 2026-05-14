import { describe, it, expect, vi } from "vitest";

// Mock Anthropic SDK before importing llm.ts so the module-level client
// creation doesn't fail in a test environment without a real API key.
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

import { estimateRunCost } from "./llm";

describe("estimateRunCost", () => {
  it("returns a positive number for any valid inputs", () => {
    expect(estimateRunCost(10, 5, "claude-sonnet-4-6")).toBeGreaterThan(0);
  });

  it("scales linearly with persona count", () => {
    const cost1 = estimateRunCost(10, 5, "claude-sonnet-4-6");
    const cost2 = estimateRunCost(20, 5, "claude-sonnet-4-6");
    // 2x personas → approximately 2x cost (exact ratio depends on formula)
    expect(cost2 / cost1).toBeCloseTo(2, 0);
  });

  it("increases with more questions", () => {
    const fewQs = estimateRunCost(100, 2, "claude-sonnet-4-6");
    const manyQs = estimateRunCost(100, 10, "claude-sonnet-4-6");
    expect(manyQs).toBeGreaterThan(fewQs);
  });

  it("returns zero for zero personas", () => {
    expect(estimateRunCost(0, 5, "claude-sonnet-4-6")).toBe(0);
  });

  it("computes expected USD for a typical 100-persona 5-question run", () => {
    // 100 personas × (500 + 5×30=650 input tokens) = 65,000 input tokens
    // 100 personas × 200 output tokens = 20,000 output tokens
    // cost = (65000/1e6)*3 + (20000/1e6)*15 = 0.195 + 0.300 = 0.495
    const cost = estimateRunCost(100, 5, "claude-sonnet-4-6");
    expect(cost).toBeCloseTo(0.495, 3);
  });
});
