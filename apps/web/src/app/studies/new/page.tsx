"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const DEFAULT_DEMOGRAPHIC_SPEC = {
  age_mean: 37,
  age_sd: 12,
  gender_distribution: { male: 0.5, female: 0.5 },
  income_distribution: {
    low: 0.15,
    lower_middle: 0.2,
    middle: 0.35,
    upper_middle: 0.2,
    high: 0.1,
  },
  education_distribution: {
    high_school: 0.25,
    some_college: 0.2,
    bachelors: 0.35,
    masters: 0.15,
    doctorate: 0.05,
  },
  occupation_pool: [
    "office worker", "teacher", "nurse", "software engineer",
    "salesperson", "manager", "student", "freelancer",
    "retail associate", "accountant",
  ],
};

export default function NewStudyPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    description: "",
    sample_size: 200,
    study_context: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/studies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          demographic_spec: DEFAULT_DEMOGRAPHIC_SPEC,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to create study");
      }
      const study = await res.json();
      router.push(`/studies/${study.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">New Study</h1>

      <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-6 text-sm text-amber-800">
        <strong>Note:</strong> This platform uses between-subjects design only in V0.
        Each AI persona is assigned to exactly one condition.
        Within-subjects (repeated measures) support is planned for V1.
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 bg-white border rounded-lg p-6">
        <div>
          <label className="block text-sm font-medium mb-1">Study Title *</label>
          <input
            type="text"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="e.g., Effect of packaging complexity on purchase intent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Optional study description…"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Sample Size (N) *
          </label>
          <input
            type="number"
            required
            min={10}
            max={5000}
            value={form.sample_size}
            onChange={(e) => setForm({ ...form, sample_size: Number(e.target.value) })}
            className="w-32 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <p className="text-xs text-gray-500 mt-1">
            Total AI personas to generate across all conditions. Use the{" "}
            <a href="/power/recommend" className="text-blue-600 underline">N Recommendation Tool</a>{" "}
            to calculate optimal sample size.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Study Context</label>
          <textarea
            value={form.study_context}
            onChange={(e) => setForm({ ...form, study_context: e.target.value })}
            rows={2}
            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Optional framing context shown to each persona, e.g., 'You are completing an online survey about consumer products.'"
          />
        </div>

        {error && (
          <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create Study"}
        </button>
      </form>
    </div>
  );
}
