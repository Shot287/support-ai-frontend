// src/app/mental/defusion/page.tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const Defusion = dynamic(() => import("@/features/mental/defusion"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border p-4 text-sm text-gray-600">
      読み込み中…
    </div>
  ),
});

export default function DefusionPage() {
  return (
    <div className="x-scroll">
      <main className="app-width-guard minw-720">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">脱フュージョン</h1>
          <Link
            href="/mental"
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            ← メンタルへ戻る
          </Link>
        </div>
        <Defusion />
      </main>
    </div>
  );
}
