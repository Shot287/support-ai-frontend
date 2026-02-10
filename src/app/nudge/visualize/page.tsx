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
  // ✅ ビジュアライズはグラフや日付表示が横に広がることがあるため x-scroll を付与
  return (
    <div className="x-scroll">
      <main className="app-width-guard minw-720">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">
            デイリーメトリクス（試験までの残り日数）
          </h1>
          <Link
            href="/nudge"
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            先延ばし対策トップへ
          </Link>
        </div>

        <Visualize />
      </main>
    </div>
  );
}
