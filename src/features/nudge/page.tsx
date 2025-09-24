// 例: src/app/nudge/page.tsx （一覧ページ）
"use client";
import { useEffect, useState } from "react";
import { loadAllTechniques } from "@/features/nudge/registry";
import TechniqueCard from "@/features/nudge/TechniqueCard";

export default function NudgeIndex() {
  const [items, setItems] = useState<any[]>([]);
  const [active, setActive] = useState<any | null>(null);

  useEffect(() => { (async () => setItems(await loadAllTechniques()))(); }, []);

  return (
    <main className="mx-auto max-w-4xl p-4 space-y-4">
      {!active && items.map(t => (
        <TechniqueCard key={t.id} tech={t} onStart={() => setActive(t)} />
      ))}
      {active && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
          <button className="text-sm opacity-70 underline" onClick={() => setActive(null)}>← 戻る</button>
          <h2 className="text-xl font-bold">{active.name}</h2>
          <active.Component onDone={() => setActive(null)} />
        </div>
      )}
    </main>
  );
}
