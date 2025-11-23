// src/app/mental/emotion-labeling/page.tsx

import EmotionLabeling from "@/features/mental/emotion-labeling";

export default function EmotionLabelingPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">感情ラベリング</h1>
        <p className="text-sm text-gray-600">
          日付と状況を指定して、そのときに動いていた感情をラベリングします。
          大きな感情 → 細かい感情を選び、最大3つまで、合計100％になるように強度を調整してください。
        </p>
      </header>

      <EmotionLabeling />
    </main>
  );
}
