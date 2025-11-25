// src/app/study/math-dictionary/page.tsx
"use client";

import MathDictionary from "@/features/study/math-dictionary";

export default function MathDictionaryPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-4">
      <header className="mb-2">
        <h1 className="text-xl font-semibold">数学の記号・用語辞典</h1>
        <p className="mt-1 text-xs text-gray-500">
          微分・積分、線形代数、確率・統計など、数学の記号や用語を
          Gemini／ChatGPT の出力ごと貼り付けて整理できます（LaTeX 対応）。
        </p>
      </header>
      <MathDictionary />
    </main>
  );
}
