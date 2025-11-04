// src/app/study/page.tsx
"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function StudyPage() {
  // タイマー起動イベントを送信
  const openTimer = () => {
    const ev = new CustomEvent("study-timer:open");
    window.dispatchEvent(ev);
  };

  // PC判定
  const isPc = () =>
    typeof navigator !== "undefined" &&
    !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  const cards = [
    {
      id: "dictionary",
      title: "用語辞典",
      description: "科目別の用語を検索・整理（実装は後ほど）",
      href: "/study/dictionary",
      type: "link" as const,
    },
    {
      id: "timer",
      title: "タイマー（PC限定）",
      description:
        "最前面の小ウィンドウで学習時間を計測。他の機能を使いながら勉強を続けられます。",
      href: "#open-timer",
      type: "button" as const,
    },
  ] as const;

  useEffect(() => {
    // 他のタブからも起動できるようにする余地を残す（現時点では特に処理なし）
  }, []);

  return (
    <main>
      <h1 className="text-2xl font-bold mb-4">勉強</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) =>
          c.type === "link" ? (
            <Link
              key={c.id}
              href={c.href}
              className="block rounded-2xl border p-4 shadow-sm hover:shadow-md transition"
            >
              <h3 className="text-lg font-semibold">{c.title}</h3>
              <p className="text-sm text-gray-600 mt-1">{c.description}</p>
            </Link>
          ) : (
            isPc() && (
              <button
                key={c.id}
                onClick={openTimer}
                className="text-left block w-full rounded-2xl border p-4 shadow-sm hover:shadow-md transition"
                title="PC限定：Document Picture-in-Pictureで最前面タイマーを起動"
              >
                <h3 className="text-lg font-semibold">{c.title}</h3>
                <p className="text-sm text-gray-600 mt-1">{c.description}</p>
                <p className="mt-2 text-xs text-gray-500">
                  ※ Chromium系デスクトップブラウザ対応
                </p>
              </button>
            )
          )
        )}
      </div>
    </main>
  );
}
