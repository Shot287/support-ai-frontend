// src/app/study/python-dictionary/page.tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

// 🔥 Python 用語辞典コンポーネント（features 配下）
const PythonDictionary = dynamic(
  () => import("@/features/study/python-dictionary"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border p-4 text-sm text-gray-600">
        読み込み中…
      </div>
    ),
  }
);

export default function PythonDictionaryPage() {
  return (
    <div className="x-scroll">
      <main className="app-width-guard minw-720">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Python 用語辞典</h1>

          <Link
            href="/study"
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            ← 勉強へ戻る
          </Link>
        </div>

        <PythonDictionary />
      </main>
    </div>
  );
}
