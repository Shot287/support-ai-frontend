// src/features/nudge/techniques/round-robin.tsx
"use client";

import { useMemo, useState, useCallback } from "react";
import type { KeyboardEvent } from "react";

/* ================= 型 ================= */
type Task = { id: string; title: string; createdAt: number };
type Pair = { a: string; b: string };

type History = {
  totals: Record<string, { wins: number; losses: number }>;
  head2head: Record<string, Record<string, number>>; // head2head[a][b] = aがbに勝った数
};

type Marks = Record<string, "maru" | "batsu" | null>; // ○/×/未評価

/* ================ ユーティリティ ================ */
function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
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

// 安全アクセサ
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

/** ランキング（総当たり結果から完全順序を作る）
 *  1) 勝数（wins）降順
 *  2) 直接対戦の差（a→b と b→a の差）降順
 *  3) createdAt（古い順）
 */
function rankAll(tasks: Task[], hist: History) {
  const score = (id: string) => safeTotals(hist, id).wins;
  return tasks
    .slice()
    .sort((A, B) => {
      const a = A.id;
      const b = B.id;
      const byWins = score(b) - score(a);
      if (byWins !== 0) return byWins;

      const diff = (safeH2H(hist, a, b) - safeH2H(hist, b, a)) | 0;
      if (diff !== 0) return -diff;

      return A.createdAt - B.createdAt;
    });
}

// 日付ユーティリティ（YYYY-MM-DD / JST想定）
function today(): string {
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = p.find((x) => x.type === "year")?.value ?? "1970";
  const m = p.find((x) => x.type === "month")?.value ?? "01";
  const d = p.find((x) => x.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}
function plusDays(ymd: string, days: number): string {
  const ms = Date.parse(`${ymd}T00:00:00+09:00`);
  const d = new Date(ms + days * 86400000);
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = p.find((x) => x.type === "year")?.value ?? "1970";
  const m = p.find((x) => x.type === "month")?.value ?? "01";
  const dd = p.find((x) => x.type === "day")?.value ?? "01";
  return `${y}-${m}-${dd}`;
}

/* ================ 本体 ================ */
export default function RoundRobin() {
  // 期間（いつからいつまで）
  const [from, setFrom] = useState<string>(() => today());
  const [to, setTo] = useState<string>(() => plusDays(today(), 7));

  // タスクリスト（ToDo：総当たりへ移るまでは自由編集）
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");

  // 総当たり用の状態
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<History>(() => initHistory([]));
  const [phase, setPhase] = useState<"input" | "play" | "result">("input");

  // 振り返り（○/×）
  const [marks, setMarks] = useState<Marks>({});

  const idToTask = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);

  const validDates = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return false;
    return Date.parse(`${from}T00:00:00+09:00`) <= Date.parse(`${to}T23:59:59+09:00`);
  }, [from, to]);

  const canStart = tasks.length >= 2 && validDates;

  // ----- ToDo編集（phase === "input" のみ使用） -----
  const addTask = () => {
    const t = title.trim();
    if (!t) return;
    setTasks((prev) => {
      const item: Task = { id: uid(), title: t, createdAt: Date.now() };
      return [...prev, item];
    });
    setTitle("");
  };
  const removeTask = (id: string) => setTasks((prev) => prev.filter((x) => x.id !== id));
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

  // ----- 総当たりの開始（以降はToDo編集をロック） -----
  const start = () => {
    if (!canStart) return;
    const ids = tasks.map((t) => t.id);
    const all = shuffle(buildAllPairs(ids));
    setPairs(all);
    setCursor(0);
    setHistory(initHistory(ids));
    // 期間を確定させ、振り返りマークは未評価で初期化
    const emptyMarks: Marks = {};
    ids.forEach((id) => (emptyMarks[id] = null));
    setMarks(emptyMarks);
    setPhase("play");
  };

  // 対戦の選択
  const choose = useCallback(
    (winner: string, loser: string) => {
      setHistory((h) => {
        const c: History = {
          totals: { ...h.totals },
          head2head: Object.fromEntries(Object.entries(h.head2head).map(([k, v]) => [k, { ...v }])),
        };
        recordWinLose(c, winner, loser);
        return c;
      });

      setCursor((x) => {
        const nx = x + 1;
        if (nx >= pairs.length) setPhase("result");
        return nx;
      });
    },
    [pairs.length]
  );

  const current = pairs[cursor];
  const progress = `${Math.min(cursor + 1, pairs.length)} / ${pairs.length}`;
  const ranking = useMemo(() => rankAll(tasks, history), [tasks, history]);

  // マーク切り替え（○/×/未評価）
  const toggleMark = (id: string, value: "maru" | "batsu") => {
    setMarks((m) => {
      const cur = m[id] ?? null;
      // 同じボタンでトグル（同値→未評価、異なる→その値）
      const next: Marks = { ...m, [id]: cur === value ? null : value };
      return next;
    });
  };

  const doneCount = Object.values(marks).filter((v) => v === "maru").length;
  const totalCount = Object.keys(marks).length;

  return (
    <div className="rounded-2xl border p-6 shadow-sm grid gap-6">
      {/* === 期間（いつからいつまで） === */}
      <section className="rounded-xl border p-4">
        <h2 className="font-semibold mb-3">対象期間</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-xl border px-3 py-2"
            aria-label="開始日"
          />
          <span className="text-sm text-gray-600">〜</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-xl border px-3 py-2"
            aria-label="終了日"
          />
          {!validDates && (
            <span className="text-xs text-red-600">開始日は終了日以前にしてください</span>
          )}
          {phase !== "input" && (
            <span className="text-xs text-gray-500">※ 期間は確定済みです</span>
          )}
        </div>
      </section>

      {/* === ToDo入力（phase: input） === */}
      {phase === "input" && (
        <section className="rounded-xl border p-4">
          <h2 className="text-xl font-semibold mb-3">ToDoリスト（開始前は自由に編集）</h2>
          <div className="flex gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="やるべきタスクを入力"
              className="w-full rounded-xl border px-3 py-2"
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTask();
                }
              }}
              aria-label="タスク入力"
            />
            <button onClick={addTask} className="rounded-xl border px-4 py-2 hover:bg-gray-50">
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
            {tasks.length === 0 && (
              <li className="text-sm text-gray-500">まだタスクがありません。</li>
            )}
          </ul>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              現在 {tasks.length} 件。※2件以上＋期間が有効で開始できます
            </div>
            <button
              onClick={start}
              disabled={!canStart}
              className="rounded-xl bg-black px-5 py-2 text-white disabled:bg-gray-300"
              title={!validDates ? "期間が不正です" : tasks.length < 2 ? "タスクが足りません" : ""}
            >
              総当たり方式へ進む（編集を確定）
            </button>
          </div>
        </section>
      )}

      {/* === 総当たり（phase: play） === */}
      {phase === "play" && current && (
        <section className="rounded-xl border p-4">
          <div className="mb-2 text-sm text-gray-600">
            期間: <span className="tabular-nums">{from}</span> 〜{" "}
            <span className="tabular-nums">{to}</span> ／ 進行 {progress}
          </div>

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

      {/* === 結果 & 振り返り（phase: result） === */}
      {phase === "result" && (
        <section className="rounded-xl border p-4 grid gap-6">
          <div>
            <h2 className="text-xl font-semibold mb-1">優先順位（総当たり）</h2>
            <div className="text-sm text-gray-600 mb-3">
              期間: <span className="tabular-nums">{from}</span> 〜{" "}
              <span className="tabular-nums">{to}</span>
            </div>
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
          </div>

          <div>
            <h3 className="font-semibold mb-2">振り返り（期間内に行動できた？）</h3>
            <ul className="space-y-2">
              {ranking.map((t) => {
                const mark = marks[t.id] ?? null;
                return (
                  <li
                    key={t.id}
                    className="flex items-center justify-between rounded-xl border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{t.title}</div>
                      <div className="text-xs text-gray-500">
                        期間: {from} 〜 {to}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => toggleMark(t.id, "maru")}
                        className={`rounded-lg border px-3 py-1 text-sm ${
                          mark === "maru" ? "bg-green-600 text-white" : "hover:bg-gray-50"
                        }`}
                        title="○（できた）"
                      >
                        ○
                      </button>
                      <button
                        onClick={() => toggleMark(t.id, "batsu")}
                        className={`rounded-lg border px-3 py-1 text-sm ${
                          mark === "batsu" ? "bg-red-600 text-white" : "hover:bg-gray-50"
                        }`}
                        title="×（できなかった）"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-3 text-sm text-gray-700">
              集計: <b>{doneCount}</b> / {totalCount} 件が「○」でした
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                // 同じタスクリストで再度比較（期間は固定、追加編集不可）
                const ids = tasks.map((x) => x.id);
                setPairs(shuffle(buildAllPairs(ids)));
                setCursor(0);
                setHistory(initHistory(ids));
                setPhase("play");
              }}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
              title="タスクリストは固定のまま、比較順を変えてもう一度"
            >
              もう一度（同じリストで比較）
            </button>
            <button
              onClick={() => {
                // 完全リセット（最初から作り直し可能に）
                setTasks([]);
                setTitle("");
                setPairs([]);
                setCursor(0);
                setHistory(initHistory([]));
                setMarks({});
                setFrom(today());
                setTo(plusDays(today(), 7));
                setPhase("input");
              }}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              期間・ToDoから作り直す
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
