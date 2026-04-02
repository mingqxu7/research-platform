"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const DEFAULT_TEMPS = [0.3, 0.5, 0.7, 1.0];

interface CalibResult {
  temperature: number;
  question_stats: Record<string, { mean: number; sd: number; se: number; n: number }>;
  divergence_from_human_sd: number | null;
}

interface CalibRun {
  id: string;
  status: string;
  temperatures: string;
  n_per_temperature: number;
  completed_at?: string;
  temperature_results?: CalibResult[];
  recommended_temperature?: number | null;
  completed_calls?: number;
}

interface Study {
  id: string;
  title: string;
  temperature?: number;
  questions: Array<{ id: string; text: string; is_open_ended: boolean }>;
}

export default function CalibrationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [study, setStudy] = useState<Study | null>(null);
  const [calibRuns, setCalibRuns] = useState<CalibRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<CalibRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);

  // Start calibration form
  const [temperatures, setTemperatures] = useState<string>(DEFAULT_TEMPS.join(", "));
  const [nPerTemp, setNPerTemp] = useState(30);
  const [humanSds, setHumanSds] = useState<string>("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Lock temperature
  const [lockingTemp, setLockingTemp] = useState<number | null>(null);

  async function fetchStudy() {
    const res = await fetch(`${API}/studies/${id}`);
    if (res.ok) setStudy(await res.json());
  }

  async function fetchCalibRuns() {
    const res = await fetch(`${API}/studies/${id}/calibration`);
    if (res.ok) setCalibRuns(await res.json());
  }

  async function fetchCalibRunDetail(calibId: string) {
    const res = await fetch(`${API}/studies/${id}/calibration/${calibId}`);
    if (res.ok) {
      const data = await res.json();
      setSelectedRun(data);
      return data;
    }
    return null;
  }

  useEffect(() => {
    Promise.all([fetchStudy(), fetchCalibRuns()]).finally(() => setLoading(false));
  }, [id]);

  // Poll selected run if it's still running
  useEffect(() => {
    if (!selectedRun || selectedRun.status === "complete") return;
    setPolling(true);
    const interval = setInterval(async () => {
      const updated = await fetchCalibRunDetail(selectedRun.id);
      if (updated?.status === "complete") {
        clearInterval(interval);
        setPolling(false);
        await fetchCalibRuns();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedRun?.id, selectedRun?.status]);

  async function startCalibration(e: React.FormEvent) {
    e.preventDefault();
    setStartError(null);
    setStarting(true);

    const parsedTemps = temperatures
      .split(",")
      .map((t) => parseFloat(t.trim()))
      .filter((t) => !isNaN(t));

    if (parsedTemps.length === 0) {
      setStartError("Enter at least one temperature value.");
      setStarting(false);
      return;
    }

    let parsedHumanSds: Record<string, number> | undefined;
    if (humanSds.trim()) {
      try {
        parsedHumanSds = JSON.parse(humanSds);
      } catch {
        setStartError("Invalid JSON for human reference SDs.");
        setStarting(false);
        return;
      }
    }

    const payload: Record<string, unknown> = {
      temperatures: parsedTemps,
      n_per_temperature: nPerTemp,
    };
    if (parsedHumanSds) payload.human_reference_sds = parsedHumanSds;

    const res = await fetch(`${API}/studies/${id}/calibration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      await fetchCalibRuns();
      const run = await fetchCalibRunDetail(data.calibration_run_id);
      setSelectedRun(run);
    } else {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      setStartError(err.error ?? "Failed to start calibration");
    }
    setStarting(false);
  }

  async function lockTemperature(temp: number) {
    setLockingTemp(temp);
    const res = await fetch(`${API}/studies/${id}/calibration/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temperature: temp }),
    });
    if (res.ok) {
      await fetchStudy();
    }
    setLockingTemp(null);
  }

  if (loading) return <div className="text-gray-500">Loading…</div>;
  if (!study) return <div className="text-red-500">Study not found.</div>;

  const analyticQuestions = study.questions?.filter((q) => !q.is_open_ended) ?? [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-sm text-gray-500 mb-1">
            <Link href="/studies" className="hover:text-blue-600">Studies</Link>
            {" / "}
            <Link href={`/studies/${id}`} className="hover:text-blue-600">{study.title}</Link>
            {" / "}
            <span>Temperature Calibration</span>
          </div>
          <h1 className="text-2xl font-bold">Temperature Calibration</h1>
        </div>
        {study.temperature && (
          <div className="px-4 py-2 bg-green-50 border border-green-200 rounded text-sm text-green-800 font-medium">
            Locked: T = {study.temperature}
          </div>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800 mb-6">
        <strong>Why calibrate?</strong> Per spec Section 7.2: temperature controls within-group variance.
        Too low → compressed variance → inflated effect sizes. Too high → noisy responses.
        Run at multiple temperatures and lock the one whose SD best matches your human reference data.
        <br />
        <span className="text-blue-600 mt-1 block">
          Default temperatures: 0.3, 0.5, 0.7, 1.0 — run 20–50 personas each.
        </span>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Run list + start form */}
        <div className="col-span-1 space-y-4">
          {/* Existing runs */}
          {calibRuns.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Past Runs</div>
              <div className="space-y-2">
                {calibRuns.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => fetchCalibRunDetail(r.id)}
                    className={`w-full text-left p-3 border rounded-lg text-sm transition-all ${
                      selectedRun?.id === r.id
                        ? "border-blue-400 bg-blue-50"
                        : "bg-white hover:border-gray-400"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-gray-500">{r.id.slice(0, 8)}…</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        r.status === "complete" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                      }`}>{r.status}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      N={r.n_per_temperature} per temp
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Start new calibration form */}
          <form onSubmit={startCalibration} className="bg-white border rounded-lg p-4 space-y-3">
            <h3 className="font-medium text-sm">Run New Calibration</h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Temperatures (comma-separated)</label>
              <input
                type="text"
                value={temperatures}
                onChange={(e) => setTemperatures(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Personas per temperature (N)</label>
              <input
                type="number"
                value={nPerTemp}
                onChange={(e) => setNPerTemp(Number(e.target.value))}
                min={10}
                max={200}
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Human reference SDs (optional JSON)
              </label>
              <textarea
                value={humanSds}
                onChange={(e) => setHumanSds(e.target.value)}
                rows={3}
                placeholder={'{"<question_id>": 1.2, ...}'}
                className="w-full border rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <div className="text-xs text-gray-400 mt-0.5">
                If provided, temperatures are ranked by how closely their SD matches human panel SD.
              </div>
            </div>
            {startError && (
              <div className="text-sm text-red-600">{startError}</div>
            )}
            <button
              type="submit"
              disabled={starting}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {starting ? "Starting…" : "Run Calibration"}
            </button>
          </form>
        </div>

        {/* Right: Results */}
        <div className="col-span-2">
          {!selectedRun && (
            <div className="bg-white border rounded-lg p-8 text-center text-gray-500 text-sm">
              Select a calibration run or start a new one.
            </div>
          )}

          {selectedRun && selectedRun.status !== "complete" && (
            <div className="bg-white border rounded-lg p-6 text-center">
              <div className="text-blue-600 font-medium mb-2">Calibration running…</div>
              <div className="text-sm text-gray-500">
                {selectedRun.completed_calls ?? 0} calls completed
                {polling && <span className="ml-2 text-xs text-gray-400">(refreshing every 5s)</span>}
              </div>
            </div>
          )}

          {selectedRun?.status === "complete" && selectedRun.temperature_results && (
            <div className="space-y-4">
              {selectedRun.recommended_temperature !== null && selectedRun.recommended_temperature !== undefined && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
                  <strong>Recommended temperature: {selectedRun.recommended_temperature}</strong>
                  {" "}(lowest divergence from human reference SDs)
                  <button
                    onClick={() => lockTemperature(selectedRun.recommended_temperature!)}
                    disabled={lockingTemp !== null}
                    className="ml-4 px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
                  >
                    {lockingTemp === selectedRun.recommended_temperature ? "Locking…" : "Lock This Temperature"}
                  </button>
                </div>
              )}

              {/* SD comparison chart per question */}
              {analyticQuestions.slice(0, 4).map((q) => {
                const chartData = selectedRun.temperature_results!.map((r) => ({
                  temp: `T=${r.temperature}`,
                  sd: r.question_stats[q.id]?.sd?.toFixed(3) ?? null,
                  mean: r.question_stats[q.id]?.mean?.toFixed(3) ?? null,
                })).filter((d) => d.sd !== null);

                if (chartData.length === 0) return null;

                return (
                  <div key={q.id} className="bg-white border rounded-lg p-4">
                    <div className="text-sm font-medium mb-1 truncate">{q.text}</div>
                    <div className="text-xs text-gray-500 mb-3">Within-group SD across temperatures</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={chartData}>
                        <XAxis dataKey="temp" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="sd" fill="#6366f1" name="SD" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })}

              {/* Temperature comparison table */}
              <div className="bg-white border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Temperature</th>
                      <th className="text-right px-4 py-3 font-medium">Avg SD</th>
                      <th className="text-right px-4 py-3 font-medium">Divergence from Human</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRun.temperature_results.map((r, idx) => {
                      const sds = Object.values(r.question_stats).map((s) => s.sd);
                      const avgSd = sds.length > 0
                        ? (sds.reduce((a, b) => a + b, 0) / sds.length).toFixed(3)
                        : "—";

                      return (
                        <tr
                          key={r.temperature}
                          className={`border-b last:border-0 ${idx === 0 && r.divergence_from_human_sd !== null ? "bg-green-50" : ""}`}
                        >
                          <td className="px-4 py-3 font-mono">{r.temperature}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs">{avgSd}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {r.divergence_from_human_sd !== null
                              ? r.divergence_from_human_sd.toFixed(4)
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => lockTemperature(r.temperature)}
                              disabled={lockingTemp !== null || study.temperature === r.temperature}
                              className={`text-xs px-2 py-1 rounded border ${
                                study.temperature === r.temperature
                                  ? "border-green-400 text-green-700 bg-green-50"
                                  : "border-gray-300 hover:border-blue-400 hover:text-blue-600"
                              } disabled:opacity-50`}
                            >
                              {study.temperature === r.temperature
                                ? "Locked"
                                : lockingTemp === r.temperature
                                ? "Locking…"
                                : "Lock"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
