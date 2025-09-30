// src/features/nudge/techniques/tournament.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

type Task = { id: string; title: string; createdAt: number };

type Step = "input" | "play" | "tiebreak" | "result";
type Pair = { a: string; b: string | null }; // b=null は不戦勝

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

function seedRound(ids: string[]): Pair[] {
  const s = shuffle(ids);
  const pairs: Pair[] = [];
  for (let i = 0; i < s.length; i += 2) {
    const a = s[i];
    const b = s[i + 1] ?? null; // 奇数なら不戦勝
    pairs.push({ a, b });
  }
  return pairs;
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

// --- 安全アクセサ ---
function safeTotals(hist: History, id: string) {
  return hist.totals[id] ?? { wins: 0, losses: 0 };
}
function safeH2H(hist: History, a: string, b: string) {
  return hist.head2head[a]?.[b] ?? 0;
}

function recordWinLose(hist: History, winner: string, loser: string | null) {
  // 勝者
  hist.totals[winner] = safeTotals(hist, winner);
  hist.totals[winner].wins += 1;

  // 不戦勝ならここで終了
  if (loser === null) return;

  // 敗者
  hist.totals[loser] = safeTotals(hist, loser);
  hist.totals[loser].losses += 1;

  // 直接対戦
  hist.head2head[winner] = { ...(hist.head2head[winner] ?? {}) };
  hist.head2head[winner][loser] = safeH2H(hist, winner, loser) + 1;
}

/** ランキング計算:
 *  1) Copelandスコア（wins - losses）降順
 *  2) 直接対戦の勝ち数（aがbに何勝しているか）
 *  3) createdAt（古い＝先に入れた）優先
 * タイブレーク候補のグループも返す
 */
function rankAll(
  tasks: Task[],
  hist: History
): { ranking: Task[]; hasTie: boolean; tieGroups: string[][] } {
  const score = (id: string) => {
    const t = safeTotals(hist, id);
    return t.wins - t.losses;
  };

  const sorted = tasks.slice().sort((A, B) => {
    const a = A.id;
    const b = B.id;

    // 1) Copeland
    const s = score(b) - score(a);
    if (s !== 0) return s;

    // 2) 直接対戦
    const headAB = safeH2H(hist, a, b);
    const headBA = safeH2H(hist, b, a);
    const h = headAB - headBA;
    if (h !== 0) return -h; // aがbに多く勝っていればaを上位

    // 3) 安定ソート
    return A.createdAt - B.createdAt;
  });

  // 見かけ上の同率グループ（上の評価3条件すべて同じものをまとめる）
  const tieGroups: string[][] = [];
  let i = 0;
  while (i < sorted.length) {
    const group = [sorted[i]];
    let j = i + 1;
    while (j < sorted.length) {
      const a = sorted[i].id;
      const b = sorted[j].id;
      const sameScore = score(a) === score(b) && safeH2H(hist, a, b) === safeH2H(hist, b, a);
      const sameCreated = sorted[i].createdAt === sorted[j].createdAt;
      if (sameScore && sameCreated) {
        group.push(sorted[j]);
        j++;
      } else break;
    }
    if (group.length > 1) tieGroups.push(group.map((t) => t.id));
    i = j;
  }

  return { ranking: sorted, hasTie: tieGroups.length > 0, tieGroups };
}

export default function Tournament() {
  const [step, setStep] = useState<Step>("input");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState(""); // 入力欄
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [cursor, setCursor] = useState(0); // pairs の進行位置
  const [nextIds, setNextIds] = useState<string[]>([]);
  const [history, setHistory] = useState<History>(() => initHistory([]));

  // タイブレーク用キュー（同率グループ内の対戦）
  const [tieQueue, setTieQueue] = useState<Array<{ a: string; b: string }>>([]);

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

  const startTournament = () => {
    const ids = tasks.map((t) => t.id);
    setHistory(initHistory(ids)); // 参加者で履歴を初期化
    setPairs(seedRound(ids));
    setRoundIndex(1);
    setCursor(0);
    setNextIds([]);
    setStep("play");
  };

  const chooseWinner = useCallback((winner: string, loser: string | null) => {
    // 勝敗記録（安全コピー＋未定義ガード）
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

    // 次ラウンド進出
    setNextIds((prev) => [...prev, winner]);

    // 次の試合へ
    setCursor((x) => x + 1);
  }, []);

  // ラウンド終了判定 & 次ラウンド準備
  const onNextIfRoundEnd = useCallback(() => {
    if (cursor < pairs.length) return; // まだラウンド中

    // ラウンド終了
    if (nextIds.length <= 1) {
      // チャンピオン決定 or 参加2未満 → ランキング計算
      const { hasTie, tieGroups } = rankAll(tasks, history);
      if (hasTie) {
        // 同率グループの全ペアをキュー
        const q: Array<{ a: string; b: string }> = [];
        tieGroups.forEach((group) => {
          const g = shuffle(group);
          for (let i = 0; i < g.length; i++) {
            for (let j = i + 1; j < g.length; j++) {
              q.push({ a: g[i], b: g[j] });
            }
          }
        });
        setTieQueue(q);
        setStep("tiebreak");
      } else {
        setStep("result");
      }
      return;
    }

    // 次ラウンドを生成
    setPairs(seedRound(nextIds));
    setRoundIndex((r) => r + 1);
    setCursor(0);
    setNextIds([]);
  }, [cursor, pairs.length, nextIds, tasks, history]);

  // タイブレーク処理
  const chooseTieWinner = (winner: string, loser: string) => {
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
    setTieQueue((q) => q.slice(1));
  };

  const currentPair = pairs[cursor];
  const { ranking } = useMemo(() => rankAll(tasks, history), [tasks, history]);

  // 表示用の進捗
  const playProgress = `${Math.min(cursor + 1, pairs.length)} / ${pairs.length}`;
  const roundLabel = `Round ${roundIndex}`;

  return (
    <div className="rounded-2xl border p-6 shadow-sm">
      {step === "input" && (
        <div>
          <h2 className="text-xl font-semibold mb-3">タスクを入力</h2>

          <div className="flex gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="やるべきタスクを入力"
              className="w-full rounded-xl border px-3 py-2"
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                // 日本語入力中（変換確定中）の Enter は無視
                if (e.nativeEvent.isComposing) return;
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
                    aria-label={`${t.title} を上へ`}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(t.id, +1)}
                    disabled={idx === tasks.length - 1}
                    className="rounded-lg border px-2 py-1 text-sm disabled:opacity-40"
                    aria-label={`${t.title} を下へ`}
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeTask(t.id)}
                    className="rounded-lg border px-2 py-1 text-sm"
                    aria-label={`${t.title} を削除`}
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
              onClick={startTournament}
              disabled={!canStart}
              className="rounded-xl bg-black px-5 py-2 text-white disabled:bg-gray-300"
            >
              トーナメント開始
            </button>
          </div>
        </div>
      )}

      {step === "play" && currentPair && (
        <div>
          <div className="mb-2 text-sm text-gray-600">{roundLabel}</div>
          <div className="mb-6 text-sm text-gray-600">進行 {playProgress}</div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => chooseWinner(currentPair.a, currentPair.b)}
              className="rounded-2xl border px-4 py-6 text-left hover:shadow"
            >
              <div className="text-lg font-semibold">
                {idToTask[currentPair.a]?.title ?? "?"}
              </div>
              <div className="mt-1 text-sm text-gray-600">優先度が高い</div>
            </button>

            <button
              disabled={!currentPair.b}
              onClick={() =>
                currentPair.b && chooseWinner(currentPair.b, currentPair.a)
              }
              className="rounded-2xl border px-4 py-6 text-left hover:shadow disabled:opacity-50"
            >
              <div className="text-lg font-semibold">
                {currentPair.b ? idToTask[currentPair.b]?.title : "不戦勝"}
              </div>
              <div className="mt-1 text-sm text-gray-600">
                {currentPair.b ? "優先度が高い" : "自動的にAが勝利します"}
              </div>
            </button>
          </div>

          <div className="mt-6">
            <button
              onClick={onNextIfRoundEnd}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              次へ（必要なら次ラウンドへ進みます）
            </button>
          </div>
        </div>
      )}

      {step === "tiebreak" && (
        <div>
          <h2 className="text-xl font-semibold mb-3">同率解消プレーオフ</h2>
          {tieQueue.length > 0 ? (
            <>
              <p className="mb-4 text-sm text-gray-600">
                同率がなくなるまで、同率グループ内で追加対戦を行います（残り
                {tieQueue.length} 試合）。
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => chooseTieWinner(tieQueue[0].a, tieQueue[0].b)}
                  className="rounded-2xl border px-4 py-6 text-left hover:shadow"
                >
                  <div className="text-lg font-semibold">
                    {idToTask[tieQueue[0].a]?.title}
                  </div>
                  <div className="mt-1 text-sm text-gray-600">優先度が高い</div>
                </button>
                <button
                  onClick={() => chooseTieWinner(tieQueue[0].b, tieQueue[0].a)}
                  className="rounded-2xl border px-4 py-6 text-left hover:shadow"
                >
                  <div className="text-lg font-semibold">
                    {idToTask[tieQueue[0].b]?.title}
                  </div>
                  <div className="mt-1 text-sm text-gray-600">優先度が高い</div>
                </button>
              </div>

              <div className="mt-6 text-sm text-gray-600">
                プレイオフ進行: {Math.max(0, tieQueue.length - 1)} /{" "}
                {Math.max(1, tieQueue.length)}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <p className="text-green-700">
                追加対戦は完了しました。順位の再計算が可能です。
              </p>
              <button
                onClick={() => {
                  // まだ同率があれば再キュー、なければ確定
                  const { hasTie, tieGroups } = rankAll(tasks, history);
                  if (hasTie) {
                    const q: Array<{ a: string; b: string }> = [];
                    tieGroups.forEach((group) => {
                      const g = shuffle(group);
                      for (let i = 0; i < g.length; i++) {
                        for (let j = i + 1; j < g.length; j++) {
                          q.push({ a: g[i], b: g[j] });
                        }
                      }
                    });
                    setTieQueue(q);
                  } else {
                    setStep("result");
                  }
                }}
                className="rounded-xl bg-black px-5 py-2 text-white"
              >
                順位を確定する
              </button>
            </div>
          )}
        </div>
      )}

      {step === "result" && (
        <div>
          <h2 className="text-xl font-semibold mb-3">優先順位リスト</h2>
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
                // 再挑戦（入力を残したまま、履歴だけ初期化）
                const ids = tasks.map((x) => x.id);
                setHistory(initHistory(ids));
                setPairs(seedRound(ids));
                setRoundIndex(1);
                setCursor(0);
                setNextIds([]);
                setTieQueue([]);
                setStep("play");
              }}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              もう一度トーナメント
            </button>
            <button
              onClick={() => {
                // 最初から（タスクもリセット）
                setTasks([]);
                setTitle("");
                setPairs([]);
                setCursor(0);
                setNextIds([]);
                setHistory(initHistory([]));
                setTieQueue([]);
                setRoundIndex(0);
                setStep("input");
              }}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              最初からやり直す
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
