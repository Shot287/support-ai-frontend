// src/app/mental/expressive-writing/page.tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

// ローカルストレージ & window を使うので dynamic import（ssr: false）
const ExpressiveWriting = dynamic(
  () => import("@/features/mental/expressive-writing"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border p-4 text-sm text-gray-600">
        読み込み中…
      </div>
    ),
  }
);

export default function ExpressiveWritingPage() {
  return (
    <div className="x-scroll">
      <main className="app-width-guard minw-720">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">エクスプレッシブライティング</h1>
          <Link
            href="/mental"
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            ← Mental へ戻る
          </Link>
        </div>
        <ExpressiveWriting />
      </main>
    </div>
  );
}
