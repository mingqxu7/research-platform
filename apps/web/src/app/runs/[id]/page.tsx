"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface Finding {
  question_id: string;
  question_text: string;
  scale_type: string;
  test_type: string;
  test_statistic: number;
  p_value_raw: number;
  p_value_bh_fdr: number;
  effect_size: number;
  effect_size_type: string;
  effect_ci_lower: number;
  effect_ci_upper: number;
  condition_stats: Record<string, { mean: number; sd: number; se: number; n: number }>;
  replicated_goal1: boolean | null;
  replicated_goal2: boolean | null;
  levene_stat: number;
  levene_p: number;
}

interface RunResult {
  run: {
    id: string;
    status: string;
    total_personas: number;
    completed_personas: number;
    tokens_used: number;
    estimated_cost_usd: number;
  };
  replication_rates: {
    goal1_pct: number | null;
    goal2_pct: number | null;
  };
  findings: Finding[];
}

export default function RunResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    async function fetchResults() {
      const res = await fetch(`${API}/runs/${id}/results`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (json.run.status === "complete" || json.run.status === "failed") {
          clearInterval(interval);
        }
      }
      setLoading(false);
    }

    fetchResults();
    interval = setInterval(fetchResults, 5000); // poll every 5s while running
    return () => clearInterval(interval);
  }, [id]);

  if (loading) return <div className="text-gray-500">Loading results…</div>;
  if (!data) return <div className="text-red-500">Run not found.</div>;

  const { run, replication_rates, findings } = data;
  const isRunning = run.status !== "complete" && run.status !== "failed";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Run Results</h1>
        <div className="flex gap-2">
          <a
            href={`${API}/runs/${id}/export/csv`}
            className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
          >
            Download CSV
          </a>
          <a
            href={`${API}/runs/${id}/export/report`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50 bg-white"
            title="Opens printable HTML report — use browser Print → Save as PDF"
          >
            Download Report (PDF)
          </a>
        </div>
      </div>

      {/* Run summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Status</div>
          <div className={`font-semibold ${
            run.status === "complete" ? "text-green-600" :
            run.status === "failed" ? "text-red-600" : "text-blue-600"
          }`}>{run.status}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Progress</div>
          <div className="font-semibold">{run.completed_personas} / {run.total_personas}</div>
          {isRunning && (
            <div className="h-1 bg-gray-200 rounded mt-2">
              <div
                className="h-1 bg-blue-500 rounded transition-all"
                style={{ width: `${run.total_personas > 0 ? (run.completed_personas / run.total_personas) * 100 : 0}%` }}
              />
            </div>
          )}
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Replication Rate (Goal 1)</div>
          <div className="font-semibold">
            {replication_rates.goal1_pct !== null ? `${replication_rates.goal1_pct}%` : "—"}
          </div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Replication Rate (Goal 2)</div>
          <div className="font-semibold">
            {replication_rates.goal2_pct !== null ? `${replication_rates.goal2_pct}%` : "—"}
          </div>
        </div>
      </div>

      {/* Findings table */}
      {findings.length > 0 && (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Question</th>
                <th className="text-left px-4 py-3 font-medium">Test</th>
                <th className="text-right px-4 py-3 font-medium">p (BH-FDR)</th>
                <th className="text-right px-4 py-3 font-medium">Effect Size</th>
                <th className="text-center px-4 py-3 font-medium">Goal 1</th>
                <th className="text-center px-4 py-3 font-medium">Goal 2</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.question_id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 max-w-xs truncate" title={f.question_text}>
                    {f.question_text}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{f.test_type}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {f.p_value_bh_fdr !== null
                      ? f.p_value_bh_fdr < 0.001 ? "<.001" : f.p_value_bh_fdr.toFixed(3)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {f.effect_size !== null
                      ? `${f.effect_size.toFixed(3)} (${f.effect_size_type})`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {f.replicated_goal1 === null ? "—" :
                      f.replicated_goal1 ? "✓" : "✗"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {f.replicated_goal2 === null ? "—" :
                      f.replicated_goal2 ? "✓" : "✗"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-finding bar charts */}
      {findings.slice(0, 3).map((f) => {
        if (!f.condition_stats) return null;
        const chartData = Object.entries(f.condition_stats).map(([name, stats]) => ({
          condition: name,
          mean: Number(stats.mean.toFixed(3)),
        }));

        return (
          <div key={f.question_id} className="mt-6 bg-white border rounded-lg p-4">
            <div className="font-medium mb-3">{f.question_text}</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <XAxis dataKey="condition" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="mean" fill="#3b82f6" name="Mean" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
