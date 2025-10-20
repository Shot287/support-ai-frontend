// src/app/nudge/work-log/page.tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import SubscribeControl from "@/features/push/SubscribeControl";

// WorkLog をクライアント側のみで読み込む（SSR 無効化）
const WorkLog = dynamic(
  () => import("../../../features/nudge/techniques/work-log"),
  { ssr: false }
);

export default function WorkLogPage() {
  return (
    // ✅ 横スク有効ラッパ（必要ページのみ）
    <div className="x-scroll">
      <main className="app-width-guard minw-720">
        {/* タイトル＋管理ページリンク */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">作業記録（タイムボクシング）</h1>
          <Link
            href="/nudge/work-log/manage"
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            カード管理へ
          </Link>
        </div>

        {/* Push購読ボタン */}
        <div className="mb-6">
          <SubscribeControl />
        </div>

        {/* 作業記録UI */}
        <WorkLog />
      </main>
    </div>
  );
}
