// src/app/nudge/work-log/page.tsx
"use client";

import dynamic from "next/dynamic";
import SubscribeControl from "@/features/push/SubscribeControl"; // ✅ 追加

// WorkLog をクライアント側のみで読み込む（SSR 無効化）
const WorkLog = dynamic(
  () => import("../../../features/nudge/techniques/work-log"),
  { ssr: false }
);

export default function WorkLogPage() {
  return (
    <main className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-4">
        作業記録（タイムボクシング）
      </h1>

      {/* ✅ Push購読ボタンを表示 */}
      <div className="mb-6">
        <SubscribeControl />
      </div>

      {/* 既存の作業記録UI */}
      <WorkLog />
    </main>
  );
}
