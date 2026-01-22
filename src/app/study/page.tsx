// src/app/study/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";

export default function StudyPage() {
  // タイマー起動イベントを送信
  const openTimer = () => {
    const ev = new CustomEvent("study-timer:open");
    window.dispatchEvent(ev);
  };

  // PC判定（クライアント実行前提）
  const isPc = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent),
    []
  );

  const cards = [
    {
      id: "dictionary",
      title: "用語辞典",
      description: "科目別の用語を検索・整理（実装は後ほど）",
      href: "/study/dictionary",
      type: "link" as const,
    },
    {
      id: "python-dictionary",
      title: "Python用語辞典",
      description:
        "Pythonの用語や文法・標準ライブラリの概念を登録しておける専用辞典。",
      href: "/study/python-dictionary",
      type: "link" as const,
    },
    {
      id: "dev-plan",
      title: "開発計画",
      description:
        "フォルダー→ノート→小ノート（課題点／計画など）を作成・編集",
      href: "/study/dev-plan",
      type: "link" as const,
    },
    {
      id: "output-productivity",
      title: "アウトプット管理",
      description:
        "レポート・演習・ノート整理などのアウトプット量を、月ごと・日ごとに記録します。",
      href: "/study/output-productivity",
      type: "link" as const,
    },
    {
      id: "instagram-follow-manager",
      title: "Instagram相互フォロー管理",
      description:
        "フォロー中のユーザーを登録し、相互フォロー状況や片側フォローを整理。",
      href: "/study/instagram-follow-manager",
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
    {
      id: "code-reading",
      title: "コードリーディング",
      description:
        "フォルダ階層ごとにコード、自分の解釈、AIの添削をセットで管理して復習。",
      href: "/study/code-reading",
      type: "link" as const,
    },
    {
      id: "lisp-dictionary",
      title: "Lisp用語辞典",
      description:
        "Lispの用語や特殊形式・マクロなどを登録できる専用辞典。",
      href: "/study/lisp-dictionary",
      type: "link" as const,
    },
    {
      id: "math-logic-expansion",
      title: "数学",
      description:
        "数学の問題画像と、自分の解釈・AI添削・途中式をセットで管理（LaTeX対応）。",
      href: "/study/math-logic-expansion",
      type: "link" as const,
    },
    {
      id: "math-formulas",
      title: "数学公式",
      description:
        "タイトルごとに複数の公式を登録。裏向け→めくるで復習（LaTeX/Gemini対応）。",
      href: "/study/math-formulas",
      type: "link" as const,
    },
    {
      id: "math-dictionary",
      title: "数学記号・用語辞典",
      description:
        "数学の記号・用語を登録・検索。Gemini対応入力欄でLaTeXを含む回答をそのまま貼り付けできます。",
      href: "/study/math-dictionary",
      type: "link" as const,
    },
    {
      id: "sapuri-wordbook",
      title: "スタディサプリ対応英単語帳",
      description:
        "スタディサプリの番号つき英単語をJSONでインポートして、暗記テスト＆マーク付き復習。",
      href: "/study/sapuri-wordbook",
      type: "link" as const,
    },
    {
      id: "sapuri-part2",
      title: "スタディサプリ対応 Part2",
      description:
        "Part2（応答問題）をJSONでインポートして、問題→選択肢音声→選択→正誤→解説まで学習。",
      href: "/study/sapuri-part2",
      type: "link" as const,
    },
    {
      id: "english-if-then-rules",
      title: "英語 If-Then ルール",
      description:
        "If(英文)→Then(和訳)の暗記カード。フォルダ/デッキ管理＋学習モード＋JSON入出力。",
      href: "/study/english-if-then-rules",
      type: "link" as const,
    },
    {
      id: "close-reading",
      title: "精読（SVOCMタグ付け）",
      description:
        "英文を単語に分解して、S/V/O/C/M などの役割をクリックで割り当て。精読の練習用。",
      href: "/study/close-reading",
      type: "link" as const,
    },
  ] as const;

  useEffect(() => {
    // 他タブ連携などの拡張余地（現時点では処理なし）
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
            isPc && (
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
