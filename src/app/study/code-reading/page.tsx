// src/app/study/code-reading/page.tsx
"use client";

import CodeReading from "@/features/study/code-reading";

export default function CodeReadingPage() {
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-3">コードリーディング</h1>
      <p className="text-sm text-gray-600 mb-4 leading-relaxed">
        言語ごとにフォルダを作り、その中に無制限にフォルダとファイルを追加できます。
        各ファイルでは「コード」「自分の解釈」「AIの添削」を1セットとして登録し、
        セットをいくつでも増やすことができます。
        自分の解釈とAIのコメントは裏向きにしておいて、復習するときにめくって答え合わせができます。
      </p>
      <CodeReading />
    </div>
  );
}
