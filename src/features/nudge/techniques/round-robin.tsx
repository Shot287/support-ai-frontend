// src/features/nudge/techniques/round-robin.tsx
"use client";

import { useMemo, useState, useCallback } from "react";
import type { KeyboardEvent } from "react";

type Task = { id: string; title: string; createdAt: number };
type Pair = { a: string; b: string };

type History = {
  totals: Record<string, { wins: number; losses: number }>;
  head2head: Record<string, Record<string, number>>; // head2head[a][b] = aがbに勝った数
};

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildAllPairs(ids: string[]): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      out.push({ a: ids[i], b: ids[j] });
    }
  }
  return out;
}

// --- 安全アクセサ ---
function safeTotals(hist: History, id: string) {
  return hist.totals[id] ?? { wins: 0, losses: 0 };
}
function safeH2H(hist: History, a: string, b: string) {
  return hist.head2head[a]?.[b] ?? 0;
}

function initHistory(ids: string[]): History {
  const totals: History["totals"] = {};
  const head2head: History["head2head"] = {};
  ids.forEach((id) => {
    totals[id] = { wins: 0, losses: 0 };
    head2head[id] = {};
  });
  return { totals, head2head };
}

function recordWinLose(hist: History, winner: string, loser: string) {
  hist.totals[winner] = safeTotals(hist, winner);
  hist.totals[loser] = safeTotals(hist, loser);
  hist.totals[winner].wins += 1;
  hist.totals[loser].losses += 1;

  hist.head2head[winner] = { ...(hist.head2head[winner] ?? {}) };
  hist.head2head[winner][loser] = safeH2H(hist, winner, loser) + 1;
}

/** ランキング計算（総当たりが完了している前提）:
 *  1) 勝点（wins）降順
 *  2) 直接対戦の勝ち数差（a→b と b→a の差）降順
 *  3) createdAt（古い順）で最終ブレーク（完全順序化のため）
 */
function rankAll(tasks: Task[], hist: History) {
  const score = (id: string) => safeTotals(hist, id).wins;

  return tasks
    .slice()
    .sort((A, B) => {
      const a = A.id;
      const b = B.id;

      // 1) 勝点（wins）
      const byWins = score(b) - score(a);
      if (byWins !== 0) return byWins;

      // 2) 直接対戦差分
      const diff = (safeH2H(hist, a, b) - safeH2H(hist, b, a)) | 0;
      if (diff !== 0) return -diff; // aの方が多く勝っていればaを上位

      // 3) 完全順序のための安定ブレーク
      return A.createdAt - B.createdAt;
    });
}

export default function RoundRobin() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<History>(() => initHistory([]));
  const [phase, setPhase] = useState<"input" | "play" | "result">("input");

  const idToTask = useMemo(() => {
    const m: Record<string, Task> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);

  const canStart = tasks.length >= 2;

  const addTask = () => {
    const t = title.trim();
    if (!t) return;
    setTasks((prev) => {
      const isDup = prev.length > 0 && prev[prev.length - 1].title === t;
      if (isDup) return prev;
      const item: Task = { id: uid(), title: t, createdAt: Date.now() };
      return [...prev, item];
    });
    setTitle("");
  };

  const removeTask = (id: string) => {
    setTasks((prev) => prev.filter((x) => x.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const a = prev.slice();
      [a[idx], a[j]] = [a[j], a[idx]];
      return a;
    });
  };

  const start = () => {
    const ids = tasks.map((t) => t.id);
    const all = shuffle(buildAllPairs(ids)); // 順序バイアスを避けてシャッフル
    setPairs(all);
    setCursor(0);
    setHistory(initHistory(ids));
    setPhase("play");
  };

  const choose = useCallback((winner: string, loser: string) => {
    // 記録
    setHistory((h) => {
      const c: History = {
        totals: { ...h.totals },
        head2head: Object.fromEntries(
          Object.entries(h.head2head).map(([k, v]) => [k, { ...v }])
        ),
      };
      recordWinLose(c, winner, loser);
      return c;
    });

    // 次の対戦へ
    setCursor((x) => x + 1);
    if (cursor + 1 >= pairs.length) {
      setPhase("result");
    }
  }, [cursor, pairs.length]);

  const current = pairs[cursor];
  const progress = `${Math.min(cursor + 1, pairs.length)} / ${pairs.length}`;
  const ranking = useMemo(() => rankAll(tasks, history), [tasks, history]);

  return (
    <div className="rounded-2xl border p-6 shadow-sm">
      {phase === "input" && (
        <section>
          <h2 className="text-xl font-semibold mb-3">総当たり方式</h2>
          <p className="text-gray-600 text-sm mb-4">
            全ペアを 1 回ずつ比較して、完全な優先順位を作ります。
          </p>

          <div className="flex gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="やるべきタスクを入力"
              className="w-full rounded-xl border px-3 py-2"
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.nativeEvent.isComposing) return; // 日本語入力確定中は除外
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTask();
                }
              }}
              aria-label="タスク入力"
            />
            <button
              onClick={addTask}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              追加
            </button>
          </div>

          <ul className="mt-4 space-y-2">
            {tasks.map((t, idx) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-xl border px-3 py-2"
              >
                <span className="truncate">{t.title}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => move(t.id, -1)}
                    disabled={idx === 0}
                    className="rounded-lg border px-2 py-1 text-sm disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(t.id, +1)}
                    disabled={idx === tasks.length - 1}
                    className="rounded-lg border px-2 py-1 text-sm disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeTask(t.id)}
                    className="rounded-lg border px-2 py-1 text-sm"
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              現在 {tasks.length} 件。※2件以上で開始できます
            </div>
            <button
              onClick={start}
              disabled={!canStart}
              className="rounded-xl bg-black px-5 py-2 text-white disabled:bg-gray-300"
            >
              総当たりを開始
            </button>
          </div>
        </section>
      )}

      {phase === "play" && current && (
        <section>
          <div className="mb-2 text-sm text-gray-600">進行 {progress}</div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => choose(current.a, current.b)}
              className="rounded-2xl border px-4 py-6 text-left hover:shadow"
            >
              <div className="text-lg font-semibold">
                {idToTask[current.a]?.title ?? "?"}
              </div>
              <div className="mt-1 text-sm text-gray-600">こちらが優先</div>
            </button>

            <button
              onClick={() => choose(current.b, current.a)}
              className="rounded-2xl border px-4 py-6 text-left hover:shadow"
            >
              <div className="text-lg font-semibold">
                {idToTask[current.b]?.title ?? "?"}
              </div>
              <div className="mt-1 text-sm text-gray-600">こちらが優先</div>
            </button>
          </div>
        </section>
      )}

      {phase === "result" && (
        <section>
          <h2 className="text-xl font-semibold mb-3">優先順位（総当たり）</h2>
          <ol className="list-decimal pl-5 space-y-1">
            {ranking.map((t) => (
              <li key={t.id}>
                <span className="font-medium">{t.title}</span>{" "}
                <span className="text-xs text-gray-500">
                  (W{safeTotals(history, t.id).wins}-L{safeTotals(history, t.id).losses})
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex gap-2">
            <button
              onClick={() => {
                // 同じタスクリストでやり直し（比較順をシャッフル）
                const ids = tasks.map((x) => x.id);
                setPairs(shuffle(buildAllPairs(ids)));
                setCursor(0);
                setHistory(initHistory(ids));
                setPhase("play");
              }}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              もう一度（同じリスト）
            </button>
            <button
              onClick={() => {
                // 最初から（タスクもリセット）
                setTasks([]);
                setTitle("");
                setPairs([]);
                setCursor(0);
                setHistory(initHistory([]));
                setPhase("input");
              }}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              最初からやり直す
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
