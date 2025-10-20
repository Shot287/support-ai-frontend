// src/app/nudge/round-robin/page.tsx
"use client";

import RoundRobin from "../../../features/nudge/techniques/round-robin";

export default function RoundRobinPage() {
  // ✅ 総当たり方式はタスク一覧や比較結果が横に広がる可能性があるため、x-scrollでラップ
  return (
    <div className="x-scroll">
      <main className="app-width-guard minw-720">
        <h1 className="text-2xl font-bold mb-4">総当たり方式</h1>
        <RoundRobin />
      </main>
    </div>
  );
}
