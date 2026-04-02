"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Template {
  id: string;
  title: string;
  description: string;
  source_citation: string;
  research_area: string;
  design_summary: string;
  sample_size: number;
  condition_count: number;
  question_count: number;
  expected_findings: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const AREA_COLORS: Record<string, string> = {
  "Consumer Behavior / Marketing": "bg-blue-100 text-blue-700",
  "Health Communication / Behavioral Science": "bg-green-100 text-green-700",
  "Advertising / Brand Management": "bg-purple-100 text-purple-700",
  "Consumer Psychology / E-Commerce": "bg-orange-100 text-orange-700",
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [cloning, setCloning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch(`${API}/templates`)
      .then((r) => r.json())
      .then((data) => { setTemplates(data); setLoading(false); })
      .catch(() => { setError("Failed to load templates."); setLoading(false); });
  }, []);

  async function handleClone(templateId: string) {
    setCloning(templateId);
    setError(null);
    try {
      const res = await fetch(`${API}/templates/${templateId}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Clone failed");
      const { study_id } = await res.json();
      router.push(`/studies/${study_id}`);
    } catch {
      setError("Failed to create study from template.");
      setCloning(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Study Templates</h1>
        <p className="text-gray-600">
          Start from a pre-built study design based on published research. Each template includes
          conditions, survey questions, and demographic specifications — ready to calibrate and run.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && <p className="text-gray-500">Loading templates…</p>}

      <div className="space-y-4">
        {templates.map((t) => (
          <div
            key={t.id}
            className="bg-white border rounded-lg p-5 hover:border-blue-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h2 className="font-semibold text-lg">{t.title}</h2>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      AREA_COLORS[t.research_area] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {t.research_area}
                  </span>
                </div>

                <p className="text-gray-600 text-sm mb-3">{t.description}</p>

                <div className="flex flex-wrap gap-4 text-sm text-gray-500 mb-3">
                  <span>
                    <span className="font-medium text-gray-700">Design:</span> {t.design_summary}
                  </span>
                </div>

                <div className="flex gap-5 text-sm mb-3">
                  <span className="text-gray-500">
                    <span className="font-medium text-gray-700">N =</span> {t.sample_size}
                  </span>
                  <span className="text-gray-500">
                    <span className="font-medium text-gray-700">Conditions:</span> {t.condition_count}
                  </span>
                  <span className="text-gray-500">
                    <span className="font-medium text-gray-700">Questions:</span> {t.question_count}
                  </span>
                </div>

                <div className="text-xs text-gray-400 border-t pt-2 mt-2">
                  <span className="font-medium">Source:</span> {t.source_citation}
                </div>

                <div className="mt-2 text-xs bg-amber-50 border border-amber-100 rounded p-2 text-amber-800">
                  <span className="font-medium">Expected findings:</span> {t.expected_findings}
                </div>
              </div>

              <button
                onClick={() => handleClone(t.id)}
                disabled={cloning === t.id}
                className="shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {cloning === t.id ? "Creating…" : "Use Template"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {!loading && templates.length === 0 && (
        <p className="text-gray-500">No templates available.</p>
      )}
    </div>
  );
}
