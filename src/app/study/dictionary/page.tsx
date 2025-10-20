// src/app/study/dictionary/page.tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

// ✅ features配下はエイリアスで参照（tsconfigの baseUrl/paths 前提）
const Dictionary = dynamic(() => import("@/features/study/dictionary"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border p-4 text-sm text-gray-600">読み込み中…</div>
  ),
});

export default function DictionaryPage() {
  // ✅ 用語辞典はテーブルやリストが横に広がる可能性があるため x-scroll を付与
  return (
    <div className="x-scroll">
      <main className="app-width-guard minw-720">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">用語辞典</h1>
          <Link
            href="/study"
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            ← 勉強へ戻る
          </Link>
        </div>
        <Dictionary />
      </main>
    </div>
  );
}
