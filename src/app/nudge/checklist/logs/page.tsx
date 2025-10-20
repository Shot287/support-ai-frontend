// src/app/nudge/checklist/logs/page.tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const ChecklistLogs = dynamic(() => import("@/features/nudge/techniques/checklist-logs"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border p-4 text-sm text-gray-600">読み込み中…</div>
  ),
});

export default function ChecklistLogsPage() {
  return (
    <main className="app-width-guard">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">チェックリストの記録参照</h1>
        <div className="flex gap-2">
          <Link href="/nudge/checklist" className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            チェックリストへ
          </Link>
          <Link href="/nudge" className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            先延ばし対策トップへ
          </Link>
        </div>
      </div>
      <ChecklistLogs />
    </main>
  );
}
