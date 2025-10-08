// src/app/nudge/plan/page.tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

// ✅ エイリアスで確実に解決（tsconfigの baseUrl / paths を使用）
const PlanTimeBoxing = dynamic(
  () => import("@/features/nudge/techniques/plan-timeboxing"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border p-4 text-sm text-gray-600">
        読み込み中…
      </div>
    ),
  }
);

export default function PlanPage() {
  return (
    <main className="max-w-4xl app-width-guard">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">計画（タイムボクシング）</h1>
        <Link
          href="/nudge/work-log"
          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        >
          作業記録へ
        </Link>
      </div>

      <PlanTimeBoxing />
    </main>
  );
}
