// src/app/nudge/visualize/page.tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

// 相対パスで確実に解決（features/.. に visualize.tsx が存在する前提）
const Visualize = dynamic(
  () => import("../../../features/nudge/techniques/visualize"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border p-4 text-sm text-gray-600">
        読み込み中…
      </div>
    ),
  }
);

export default function VisualizePage() {
  // ✅ このページは横スク不要：x-scroll でラップしない
  return (
    <main className="app-width-guard">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">ビジュアライズ（試験までの残り日数）</h1>
        <Link
          href="/nudge"
          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        >
          先延ばし対策トップへ
        </Link>
      </div>

      <Visualize />
    </main>
  );
}
