import Link from "next/link";

export default function Home() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold mb-3">AI Research Replication Platform</h1>
      <p className="text-gray-600 mb-8 text-lg">
        Run experimental studies with LLM-powered AI personas in minutes —
        at a fraction of the cost and time of human panels.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Link
          href="/studies/new"
          className="block p-5 border rounded-lg bg-white hover:border-blue-400 hover:shadow-sm transition-all"
        >
          <div className="text-xl mb-1">📋</div>
          <div className="font-medium">New Study</div>
          <div className="text-sm text-gray-500 mt-1">Define your research design from scratch</div>
        </Link>
        <Link
          href="/templates"
          className="block p-5 border rounded-lg bg-white hover:border-blue-400 hover:shadow-sm transition-all"
        >
          <div className="text-xl mb-1">📚</div>
          <div className="font-medium">Browse Templates</div>
          <div className="text-sm text-gray-500 mt-1">Start from a published research design</div>
        </Link>
        <Link
          href="/studies"
          className="block p-5 border rounded-lg bg-white hover:border-blue-400 hover:shadow-sm transition-all"
        >
          <div className="text-xl mb-1">🔬</div>
          <div className="font-medium">My Studies</div>
          <div className="text-sm text-gray-500 mt-1">View and manage existing studies</div>
        </Link>
        <Link
          href="/power/recommend"
          className="block p-5 border rounded-lg bg-white hover:border-blue-400 hover:shadow-sm transition-all"
        >
          <div className="text-xl mb-1">📊</div>
          <div className="font-medium">Power Analysis</div>
          <div className="text-sm text-gray-500 mt-1">Calculate required sample size</div>
        </Link>
      </div>
    </div>
  );
}
