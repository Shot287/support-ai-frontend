// src/app/nudge/plan/page.tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

// 相対パスで確実に解決（エイリアス未設定でも動作）
const PlanTimeBoxing = dynamic(
  () => import("../../../features/nudge/techniques/plan-timeboxing"),
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
  // ✅ タイムボクシングは横方向に広がる可能性があるため x-scroll でラップ
  return (
    <div className="x-scroll">
      <main className="app-width-guard minw-720">
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
    </div>
  );
}
