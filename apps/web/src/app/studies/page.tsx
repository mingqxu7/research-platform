"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Study {
  id: string;
  title: string;
  status: string;
  sample_size: number;
  created_at: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default function StudiesPage() {
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/studies`)
      .then((r) => r.json())
      .then((data) => { setStudies(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Studies</h1>
        <Link
          href="/studies/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
        >
          New Study
        </Link>
      </div>

      {loading && <p className="text-gray-500">Loading…</p>}
      {!loading && studies.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="mb-3">No studies yet.</p>
          <div className="flex justify-center gap-3 text-sm">
            <Link
              href="/studies/new"
              className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700"
            >
              Create from scratch
            </Link>
            <Link
              href="/templates"
              className="px-4 py-2 border rounded-md font-medium hover:bg-gray-50"
            >
              Browse templates
            </Link>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {studies.map((s) => (
          <Link
            key={s.id}
            href={`/studies/${s.id}`}
            className="block p-4 bg-white border rounded-lg hover:border-blue-400 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="font-medium">{s.title}</div>
              <span className={`text-xs px-2 py-1 rounded-full ${
                s.status === "completed" ? "bg-green-100 text-green-700" :
                s.status === "active" ? "bg-blue-100 text-blue-700" :
                "bg-gray-100 text-gray-600"
              }`}>
                {s.status}
              </span>
            </div>
            <div className="text-sm text-gray-500 mt-1">
              N = {s.sample_size} &middot; Created {new Date(s.created_at).toLocaleDateString()}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
