// src/app/nudge/work-log/page.tsx
"use client";

import dynamic from "next/dynamic";

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
      <WorkLog />
    </main>
  );
}
