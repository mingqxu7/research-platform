"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface PowerResult {
  n_per_group: number;
  total_n: number;
  method: string;
  inputs: {
    effect_size: number;
    power: number;
    alpha_corrected: number;
    num_conditions: number;
    num_dvs: number;
  };
  ai_persona_note: string;
}

export default function PowerRecommendPage() {
  const [form, setForm] = useState({
    effect_size: 0.3,
    effect_metric: "cohens_d",
    power: 0.8,
    alpha: 0.05,
    num_conditions: 2,
    num_dvs: 5,
  });
  const [result, setResult] = useState<PowerResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function calculate() {
    setLoading(true);
    const params = new URLSearchParams({
      effect_size: String(form.effect_size),
      effect_metric: form.effect_metric,
      power: String(form.power),
      alpha: String(form.alpha),
      num_conditions: String(form.num_conditions),
      num_dvs: String(form.num_dvs),
    });
    const res = await fetch(`${API}/power/recommend?${params}`);
    const data = await res.json();
    setResult(data);
    setLoading(false);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-2">N Recommendation Tool</h1>
      <p className="text-gray-600 mb-6 text-sm">
        Calculate the minimum sample size for your AI persona study based on expected effect size,
        desired power, and number of dependent variables.
      </p>

      <div className="bg-white border rounded-lg p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Expected Effect Size</label>
            <input type="number" step="0.01" min="0.01"
              value={form.effect_size}
              onChange={(e) => setForm({ ...form, effect_size: Number(e.target.value) })}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Effect Metric</label>
            <select
              value={form.effect_metric}
              onChange={(e) => setForm({ ...form, effect_metric: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="cohens_d">Cohen's d (2 groups)</option>
              <option value="cohens_f">Cohen's f (3+ groups)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Desired Power</label>
            <select
              value={form.power}
              onChange={(e) => setForm({ ...form, power: Number(e.target.value) })}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value={0.7}>0.70</option>
              <option value={0.8}>0.80 (recommended)</option>
              <option value={0.9}>0.90</option>
              <option value={0.95}>0.95</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Alpha (per test)</label>
            <select
              value={form.alpha}
              onChange={(e) => setForm({ ...form, alpha: Number(e.target.value) })}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value={0.05}>.05</option>
              <option value={0.01}>.01</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Number of Conditions</label>
            <input type="number" min={2} max={10}
              value={form.num_conditions}
              onChange={(e) => setForm({ ...form, num_conditions: Number(e.target.value) })}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Number of DVs (questions)</label>
            <input type="number" min={1} max={20}
              value={form.num_dvs}
              onChange={(e) => setForm({ ...form, num_dvs: Number(e.target.value) })}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
        </div>

        <button
          onClick={calculate}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Calculating…" : "Calculate"}
        </button>
      </div>

      {result && (
        <div className="mt-6 bg-white border rounded-lg p-6">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-blue-50 rounded p-3">
              <div className="text-xs text-blue-600 font-medium uppercase tracking-wide">N per group</div>
              <div className="text-3xl font-bold text-blue-700 mt-1">{result.n_per_group}</div>
            </div>
            <div className="bg-blue-50 rounded p-3">
              <div className="text-xs text-blue-600 font-medium uppercase tracking-wide">Total N</div>
              <div className="text-3xl font-bold text-blue-700 mt-1">{result.total_n}</div>
            </div>
          </div>
          <div className="text-sm text-gray-500 mb-3">
            Method: {result.method} &middot; Corrected α = {result.inputs.alpha_corrected.toFixed(4)}
          </div>
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
            {result.ai_persona_note}
          </div>
        </div>
      )}
    </div>
  );
}
