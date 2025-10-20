// src/app/nudge/todo/page.tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const TodoTechnique = dynamic(() => import("@/features/nudge/techniques/todo"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border p-4 text-sm text-gray-600">読み込み中…</div>
  ),
});

export default function TodoPage() {
  // ✅ 横スクの必要はないページ
  return (
    <main className="app-width-guard">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">ToDoリスト</h1>
        <Link href="/nudge" className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
          先延ばし対策トップへ
        </Link>
      </div>
      <TodoTechnique />
    </main>
  );
}
