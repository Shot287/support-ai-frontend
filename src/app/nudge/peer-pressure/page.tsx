"use client";

import PeerPressure from "@/features/nudge/techniques/peer-pressure";

export default function PeerPressurePage() {
  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-3">ピアプレッシャー</h1>
      <p className="text-sm text-gray-600 mb-4 leading-relaxed">
        「誰かに見られている」という適度な緊張感を利用して、先延ばしを防ぎます。
        作業を始める前に、ここで今日の目標や取り組む内容を力強く宣言してみましょう。
      </p>
      <PeerPressure />
    </div>
  );
}