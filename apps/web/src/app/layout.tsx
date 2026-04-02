import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research Platform — AI Persona Studies",
  description: "Run, replicate, and generalize experimental studies using LLM-powered AI personas.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        <nav className="border-b bg-white px-6 py-3 flex items-center gap-6 shadow-sm">
          <span className="font-semibold text-lg tracking-tight">ResearchAI</span>
          <a href="/studies" className="text-sm text-gray-600 hover:text-gray-900">Studies</a>
          <a href="/templates" className="text-sm text-gray-600 hover:text-gray-900">Templates</a>
        </nav>
        <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
