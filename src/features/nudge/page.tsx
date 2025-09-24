"use client";

import { useMemo, useState } from "react";
import { TECHNIQUES, getTechniqueMetaById } from "./registry";
import type { TechniqueId, TechniqueResult } from "./types";
import TechniqueCard from "./TechniqueCard";

export default function NudgePage() {
  const [selected, setSelected] = useState<TechniqueId | null>(null);
  const [results, setResults] = useState<TechniqueResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const selectedMeta = useMemo(
    () => (selected ? getTechniqueMetaById(selected) : null),
    [selected]
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-black/10 dark:border-white/15 bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-base font-bold">先延ばし対策（Nudge）</h1>
          <span className="text-xs opacity-70">デモ</span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-5 space-y-6">
        {/* テクニック一覧 */}
        <section className="space-y-3">
          <h2 className="font-semibold">テクニックを選択</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TECHNIQUES.map((t) => (
              <button
                key={t.id}
                className={`rounded border p-3 text-left hover:bg-black/5 dark:hover:bg-white/5 ${
                  selected === t.id
                    ? "border-emerald-500"
                    : "border-black/10 dark:border-white/15"
                }`}
                onClick={() => {
                  setErrorMsg("");
                  setSelected(t.id);
                }}
              >
                <div className="font-medium">{t.name}</div>
                <div className="text-sm opacity-70">{t.description}</div>
              </button>
            ))}
          </div>
        </section>

        {/* 実行カード */}
        <section className="space-y-3">
          <h2 className="font-semibold">実行</h2>
          {selectedMeta ? (
            <TechniqueCard
              meta={selectedMeta}
              onComplete={(r) => setResults((prev) => [r, ...prev])}
              onCancel={() => setSelected(null)}
              onError={(msg) => setErrorMsg(msg)}
            />
          ) : (
            <p className="text-sm opacity-70">上からテクニックを選んでください。</p>
          )}
          {errorMsg && (
            <p className="text-sm text-red-600 break-all">Error: {errorMsg}</p>
          )}
        </section>

        {/* 結果リスト */}
        <section className="space-y-3">
          <h2 className="font-semibold">直近の結果</h2>
          {results.length === 0 ? (
            <p className="text-sm opacity-70">(まだありません)</p>
          ) : (
            <ul className="space-y-2">
              {results.map((r, i) => (
                <li
                  key={i}
                  className="rounded border border-black/10 dark:border-white/15 p-3 text-sm"
                >
                  <div className="font-medium">
                    {getTechniqueMetaById(r.techniqueId).name}
                  </div>
                  <div className="opacity-80">
                    成功: {String(r.success)} / 時間:
                    {r.durationMs != null ? ` ${r.durationMs}ms` : " -"}
                    {r.notes ? ` / メモ: ${r.notes}` : ""}
                  </div>
                  <div className="opacity-60 text-xs">
                    {new Date().toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
