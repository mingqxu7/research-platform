"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface Condition {
  id: string;
  name: string;
  description?: string;
  stimulus_type?: string;
  stimulus_text?: string;
  order_index: number;
}

interface Question {
  id: string;
  text: string;
  scale_type: string;
  scale_points?: number;
  is_open_ended: boolean;
  order_index: number;
}

interface Run {
  id: string;
  status: string;
  total_personas: number;
  completed_personas: number;
  created_at: string;
  estimated_cost_usd: number;
}

interface Study {
  id: string;
  title: string;
  description?: string;
  status: string;
  sample_size: number;
  temperature?: number;
  model_version: string;
  study_context?: string;
  conditions: Condition[];
  questions: Question[];
}

type TabId = "overview" | "conditions" | "questions" | "runs" | "benchmarks";

export default function StudyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [study, setStudy] = useState<Study | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(true);

  // Add condition form state
  const [newConditionName, setNewConditionName] = useState("");
  const [newConditionText, setNewConditionText] = useState("");
  const [conditionSaving, setConditionSaving] = useState(false);

  // Add question form state
  const [newQuestionText, setNewQuestionText] = useState("");
  const [newQuestionScale, setNewQuestionScale] = useState<string>("likert");
  const [newQuestionPoints, setNewQuestionPoints] = useState<number>(7);
  const [questionSaving, setQuestionSaving] = useState(false);

  // Benchmark upload state
  const [benchmarkJson, setBenchmarkJson] = useState("");
  const [benchmarkSaving, setBenchmarkSaving] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);
  const [benchmarkSuccess, setBenchmarkSuccess] = useState(false);

  // Launch run state
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  async function fetchStudy() {
    const res = await fetch(`${API}/studies/${id}`);
    if (res.ok) {
      setStudy(await res.json());
    }
  }

  async function fetchRuns() {
    const res = await fetch(`${API}/studies/${id}/runs`);
    if (res.ok) {
      setRuns(await res.json());
    }
  }

  useEffect(() => {
    Promise.all([fetchStudy(), fetchRuns()]).finally(() => setLoading(false));
  }, [id]);

  async function addCondition(e: React.FormEvent) {
    e.preventDefault();
    if (!newConditionName.trim()) return;
    setConditionSaving(true);
    const res = await fetch(`${API}/studies/${id}/conditions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newConditionName.trim(),
        stimulus_type: newConditionText ? "text" : undefined,
        stimulus_text: newConditionText || undefined,
        order_index: study?.conditions.length ?? 0,
      }),
    });
    if (res.ok) {
      setNewConditionName("");
      setNewConditionText("");
      await fetchStudy();
    }
    setConditionSaving(false);
  }

  async function deleteCondition(conditionId: string) {
    await fetch(`${API}/studies/${id}/conditions/${conditionId}`, { method: "DELETE" });
    await fetchStudy();
  }

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!newQuestionText.trim()) return;
    setQuestionSaving(true);
    const payload: Record<string, unknown> = {
      text: newQuestionText.trim(),
      scale_type: newQuestionScale,
      order_index: study?.questions.length ?? 0,
    };
    if (newQuestionScale === "likert") {
      payload.scale_points = newQuestionPoints;
    }
    const res = await fetch(`${API}/studies/${id}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setNewQuestionText("");
      await fetchStudy();
    }
    setQuestionSaving(false);
  }

  async function deleteQuestion(questionId: string) {
    await fetch(`${API}/studies/${id}/questions/${questionId}`, { method: "DELETE" });
    await fetchStudy();
  }

  async function launchRun() {
    setLaunching(true);
    setLaunchError(null);
    const res = await fetch(`${API}/studies/${id}/runs`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      await fetchRuns();
      router.push(`/runs/${data.run_id}`);
    } else {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      setLaunchError(err.error ?? "Failed to launch run");
    }
    setLaunching(false);
  }

  async function uploadBenchmarks(e: React.FormEvent) {
    e.preventDefault();
    setBenchmarkError(null);
    setBenchmarkSuccess(false);
    setBenchmarkSaving(true);
    let parsed: unknown;
    try {
      parsed = JSON.parse(benchmarkJson);
    } catch {
      setBenchmarkError("Invalid JSON. Expected: { \"benchmarks\": [...] }");
      setBenchmarkSaving(false);
      return;
    }
    const res = await fetch(`${API}/studies/${id}/benchmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    if (res.ok) {
      setBenchmarkJson("");
      setBenchmarkSuccess(true);
    } else {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      setBenchmarkError(err.error ?? "Upload failed");
    }
    setBenchmarkSaving(false);
  }

  if (loading) return <div className="text-gray-500">Loading…</div>;
  if (!study) return <div className="text-red-500">Study not found.</div>;

  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "conditions", label: `Conditions (${study.conditions.length})` },
    { id: "questions", label: `Questions (${study.questions.length})` },
    { id: "runs", label: `Runs (${runs.length})` },
    { id: "benchmarks", label: "Benchmarks" },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-sm text-gray-500 mb-1">
            <Link href="/studies" className="hover:text-blue-600">Studies</Link>
            {" / "}
            <span>{study.title}</span>
          </div>
          <h1 className="text-2xl font-bold">{study.title}</h1>
          {study.description && (
            <p className="text-gray-600 mt-1 text-sm">{study.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            href={`/studies/${id}/calibration`}
            className="px-4 py-2 border rounded-md text-sm font-medium hover:bg-gray-50"
          >
            Calibrate Temperature
          </Link>
          <button
            onClick={launchRun}
            disabled={launching || study.conditions.length < 2 || study.questions.filter(q => !q.is_open_ended).length === 0}
            className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {launching ? "Launching…" : "Launch Run"}
          </button>
        </div>
      </div>

      {launchError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {launchError}
        </div>
      )}

      {!study.temperature && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
          Temperature not calibrated. Set a temperature on this study before launching a run.
          Spec requires empirical calibration (see Section 7.2).
        </div>
      )}

      {/* Tab nav */}
      <div className="border-b mb-6">
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overview tab */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="bg-white border rounded-lg p-5">
            <h2 className="font-semibold mb-3">Study Configuration</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-gray-500 mb-0.5">Sample Size (N)</div>
                <div className="font-medium">{study.sample_size}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">Model</div>
                <div className="font-medium">{study.model_version}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">Temperature</div>
                <div className={`font-medium ${!study.temperature ? "text-yellow-600" : ""}`}>
                  {study.temperature ?? "Not set (required before launch)"}
                </div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">Design</div>
                <div className="font-medium">Between-subjects (V0)</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">Status</div>
                <div className="font-medium">{study.status}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">Conditions / Questions</div>
                <div className="font-medium">
                  {study.conditions.length} conditions, {study.questions.length} questions
                  {study.questions.filter(q => q.is_open_ended).length > 0 && (
                    <span className="text-yellow-600 text-xs ml-1">
                      ({study.questions.filter(q => q.is_open_ended).length} open-ended — excluded from analysis)
                    </span>
                  )}
                </div>
              </div>
            </div>
            {study.study_context && (
              <div className="mt-4 text-sm">
                <div className="text-gray-500 mb-0.5">Study Context</div>
                <div className="bg-gray-50 rounded p-2 text-gray-700">{study.study_context}</div>
              </div>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
            <strong>Launch checklist:</strong>
            <ul className="mt-1 list-disc pl-5 space-y-0.5">
              <li className={study.conditions.length >= 2 ? "text-green-700" : "text-red-700"}>
                {study.conditions.length >= 2 ? "✓" : "✗"} At least 2 conditions defined
              </li>
              <li className={study.questions.filter(q => !q.is_open_ended).length > 0 ? "text-green-700" : "text-red-700"}>
                {study.questions.filter(q => !q.is_open_ended).length > 0 ? "✓" : "✗"} At least 1 non-open-ended question
              </li>
              <li className={study.temperature ? "text-green-700" : "text-red-700"}>
                {study.temperature ? "✓" : "✗"} Temperature calibrated
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Conditions tab */}
      {activeTab === "conditions" && (
        <div className="space-y-4">
          {study.conditions.length === 0 ? (
            <p className="text-gray-500 text-sm">No conditions yet. Add at least 2 conditions to run a study.</p>
          ) : (
            <div className="space-y-3">
              {study.conditions.map((c) => (
                <div key={c.id} className="bg-white border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium">{c.name}</div>
                      {c.description && <div className="text-sm text-gray-500 mt-0.5">{c.description}</div>}
                      {c.stimulus_text && (
                        <div className="mt-2 text-sm bg-gray-50 rounded p-2 text-gray-700">
                          <span className="text-xs text-gray-400 uppercase tracking-wide">Stimulus: </span>
                          {c.stimulus_text}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => deleteCondition(c.id)}
                      className="ml-4 text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={addCondition} className="bg-white border rounded-lg p-4 space-y-3">
            <h3 className="font-medium text-sm">Add Condition</h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Condition Name *</label>
              <input
                type="text"
                value={newConditionName}
                onChange={(e) => setNewConditionName(e.target.value)}
                placeholder="e.g. Complex packaging"
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Stimulus Text (optional)</label>
              <textarea
                value={newConditionText}
                onChange={(e) => setNewConditionText(e.target.value)}
                placeholder="Text shown to personas in this condition"
                rows={3}
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <button
              type="submit"
              disabled={conditionSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {conditionSaving ? "Adding…" : "Add Condition"}
            </button>
          </form>
        </div>
      )}

      {/* Questions tab */}
      {activeTab === "questions" && (
        <div className="space-y-4">
          {study.questions.length === 0 ? (
            <p className="text-gray-500 text-sm">No questions yet.</p>
          ) : (
            <div className="space-y-3">
              {study.questions.map((q) => (
                <div key={q.id} className="bg-white border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{q.text}</div>
                      <div className="flex gap-2 mt-1">
                        <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{q.scale_type}</span>
                        {q.scale_points && (
                          <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{q.scale_points}-point</span>
                        )}
                        {q.is_open_ended && (
                          <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded">
                            Open-ended (excluded from V0 analysis)
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteQuestion(q.id)}
                      className="ml-4 text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={addQuestion} className="bg-white border rounded-lg p-4 space-y-3">
            <h3 className="font-medium text-sm">Add Question</h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Question Text *</label>
              <input
                type="text"
                value={newQuestionText}
                onChange={(e) => setNewQuestionText(e.target.value)}
                placeholder="e.g. How likely are you to purchase this product?"
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Scale Type</label>
                <select
                  value={newQuestionScale}
                  onChange={(e) => setNewQuestionScale(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="likert">Likert</option>
                  <option value="continuous">Continuous (numeric)</option>
                  <option value="categorical">Categorical</option>
                  <option value="open_ended">Open-ended (text)</option>
                </select>
              </div>
              {newQuestionScale === "likert" && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Scale Points</label>
                  <select
                    value={newQuestionPoints}
                    onChange={(e) => setNewQuestionPoints(Number(e.target.value))}
                    className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value={4}>4-point</option>
                    <option value={5}>5-point</option>
                    <option value={7}>7-point</option>
                  </select>
                </div>
              )}
            </div>
            {newQuestionScale === "open_ended" && (
              <div className="text-xs text-yellow-700 bg-yellow-50 rounded p-2">
                Open-ended responses are collected and stored but excluded from V0 statistical analysis.
              </div>
            )}
            <button
              type="submit"
              disabled={questionSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {questionSaving ? "Adding…" : "Add Question"}
            </button>
          </form>
        </div>
      )}

      {/* Runs tab */}
      {activeTab === "runs" && (
        <div className="space-y-4">
          {runs.length === 0 ? (
            <p className="text-gray-500 text-sm">No runs yet. Launch a run from the Overview tab.</p>
          ) : (
            <div className="space-y-3">
              {runs.map((r) => (
                <Link
                  key={r.id}
                  href={`/runs/${r.id}`}
                  className="block bg-white border rounded-lg p-4 hover:border-blue-400 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm font-mono">{r.id.slice(0, 8)}…</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {new Date(r.created_at).toLocaleString()}
                        {r.estimated_cost_usd && (
                          <span className="ml-2">Est. ${r.estimated_cost_usd.toFixed(3)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-sm text-gray-500">
                        {r.completed_personas} / {r.total_personas}
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        r.status === "complete" ? "bg-green-100 text-green-700" :
                        r.status === "failed" ? "bg-red-100 text-red-700" :
                        r.status === "running" || r.status === "processing" ? "bg-blue-100 text-blue-700" :
                        "bg-gray-100 text-gray-600"
                      }`}>
                        {r.status}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Benchmarks tab */}
      {activeTab === "benchmarks" && (
        <div className="space-y-4">
          <div className="bg-white border rounded-lg p-4 text-sm text-gray-600">
            <p className="mb-2">
              Upload human study benchmarks for <strong>Goal 2 replication</strong> evaluation
              (effect size CI overlap against human reference data).
            </p>
            <p>
              Format: JSON with a <code className="bg-gray-100 px-1 rounded">benchmarks</code> array.
              Each entry requires <code className="bg-gray-100 px-1 rounded">finding_label</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">effect_size</code>, and{" "}
              <code className="bg-gray-100 px-1 rounded">effect_size_type</code>.
              Optionally include <code className="bg-gray-100 px-1 rounded">ci_lower</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">ci_upper</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">p_value</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">source_citation</code>, and{" "}
              <code className="bg-gray-100 px-1 rounded">question_id</code> to map to a specific question.
            </p>
          </div>

          <div className="bg-gray-50 border rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-2 font-medium">Example:</div>
            <pre className="text-xs text-gray-600 overflow-auto">{JSON.stringify({
              benchmarks: [
                {
                  finding_label: "Attitude toward ad (complex vs simple)",
                  effect_size: 0.42,
                  effect_size_type: "cohens_d",
                  ci_lower: 0.28,
                  ci_upper: 0.56,
                  p_value: 0.002,
                  source_citation: "Smith et al. (2023), JAR",
                }
              ]
            }, null, 2)}</pre>
          </div>

          <form onSubmit={uploadBenchmarks} className="space-y-3">
            <textarea
              value={benchmarkJson}
              onChange={(e) => setBenchmarkJson(e.target.value)}
              rows={12}
              placeholder='{ "benchmarks": [...] }'
              className="w-full border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {benchmarkError && (
              <div className="text-sm text-red-600">{benchmarkError}</div>
            )}
            {benchmarkSuccess && (
              <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2">
                Benchmarks uploaded successfully.
              </div>
            )}
            <button
              type="submit"
              disabled={benchmarkSaving || !benchmarkJson.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {benchmarkSaving ? "Uploading…" : "Upload Benchmarks"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
