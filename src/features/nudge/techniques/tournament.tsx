// src/features/nudge/techniques/tournament.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

type Task = { id: string; title: string; createdAt: number };

type Step = "input" | "play" | "place" | "result"; // ← place を追加
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

/** ランキング計算（与えた tasks の部分集合のみを整列）:
 *  1) Copeland（wins - losses）降順
 *  2) 直接対戦の勝ち数
 *  3) createdAt（古い順）
 * tieGroups: まだ同率が残っているIDグループ（この中で再戦が必要）
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
    const s = (score(b) - score(a)) | 0;
    if (s !== 0) return s;

    // 2) 直接対戦
    const headAB = safeH2H(hist, a, b);
    const headBA = safeH2H(hist, b, a);
    const h = (headAB - headBA) | 0;
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
      const sameScore =
        score(a) === score(b) && safeH2H(hist, a, b) === safeH2H(hist, b, a);
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

  // 本戦用
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [cursor, setCursor] = useState(0); // pairs の進行位置
  const [nextIds, setNextIds] = useState<string[]>([]);
  const [history, setHistory] = useState<History>(() => initHistory([]));
  const [autoAdvancing, setAutoAdvancing] = useState(false); // 不戦勝の自動進行

  // ラウンドごとの敗者を記録（順位決定戦に使用）
  const [losersByRound, setLosersByRound] = useState<Record<number, string[]>>({});

  // 順位決定戦（敗退組）用
  const [placeQueue, setPlaceQueue] = useState<string[][]>([]); // 並び順は「決勝→準決勝→…→1回戦」
  const [placeCurrent, setPlaceCurrent] = useState<string[]>([]);
  const [placeLabel, setPlaceLabel] = useState<string>("");
  const [tieQueue, setTieQueue] = useState<Array<{ a: string; b: string }>>([]); // 現在の敗退組に対する追加対戦キュー

  // 最終順位（ID順の配列）
  const [finalOrderIds, setFinalOrderIds] = useState<string[]>([]);

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
    setLosersByRound({});
    setFinalOrderIds([]);
    setPlaceQueue([]);
    setPlaceCurrent([]);
    setPlaceLabel("");
    setStep("play");
  };

  // 本戦：勝者選択（敗者はラウンド別に記録）
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

    // ラウンド敗者の記録
    if (loser) {
      setLosersByRound((prev) => {
        const list = prev[roundIndex] ? prev[roundIndex].slice() : [];
        list.push(loser);
        return { ...prev, [roundIndex]: list };
      });
    }

    // 次ラウンド進出
    setNextIds((prev) => [...prev, winner]);

    // 次の試合へ
    setCursor((x) => x + 1);
  }, [roundIndex]);

  // 不戦勝の自動消化
  useEffect(() => {
    if (step !== "play") return;
    const m = pairs[cursor];
    if (!m) return;
    if (m.b === null && !autoAdvancing) {
      setAutoAdvancing(true);
      requestAnimationFrame(() => {
        chooseWinner(m.a, null);
        setAutoAdvancing(false);
      });
    }
  }, [step, pairs, cursor, chooseWinner, autoAdvancing]);

  // ラウンド終了の自動遷移
  useEffect(() => {
    if (step !== "play") return;
    if (cursor < pairs.length) return; // まだラウンド中

    // ラウンド終了
    if (nextIds.length <= 1) {
      // チャンピオン確定 or 参加2未満 → 決勝敗者〜各敗退組の順位決定戦を準備
      // まず優勝者を確定順位に入れる
      const champion = nextIds[0] ?? pairs[pairs.length - 1]?.a; // 念のため
      const finalRound = roundIndex;

      const queue: string[][] = [];

      // 決勝敗退組（通常は1件）
      const finalsLosers = (losersByRound[finalRound] ?? []).slice();
      if (finalsLosers.length > 0) queue.push(finalsLosers);

      // 準決勝→…→1回戦 の順で追加
      for (let r = finalRound - 1; r >= 1; r--) {
        const g = (losersByRound[r] ?? []).slice();
        if (g.length > 0) queue.push(g);
      }

      setFinalOrderIds(champion ? [champion] : []);
      if (queue.length > 0) {
        setPlaceQueue(queue);
        // 先頭グループから開始
        const first = queue[0];
        setPlaceCurrent(first);
        setPlaceLabel(labelForGroup(finalRound, queue, first));
        setTieQueue(buildAllPairs(first));
        setStep("place");
      } else {
        // 敗退組がいなければすぐ結果へ
        setStep("result");
      }
      return;
    }

    // 次ラウンドを生成
    setPairs(seedRound(nextIds));
    setRoundIndex((r) => r + 1);
    setCursor(0);
    setNextIds([]);
  }, [step, cursor, pairs, nextIds, roundIndex, losersByRound]);

  // ---- 順位決定戦（敗退組）ロジック ----

  // ラベル表示（決勝/準決勝/ラウンドn）
  function labelForGroup(finalRound: number, queue: string[][], current: string[]) {
    if (queue[0] === current) return "決勝敗退組の順位決定戦";
    if (queue.length >= 2 && queue[1] === current && finalRound >= 2) return "準決勝敗退組の順位決定戦";
    // それ以降は「ラウンドn敗退組」
    const idx = queue.indexOf(current);
    const roundFromEnd = idx; // 0:決勝,1:準決勝,2:準々決勝...
    const r = finalRound - roundFromEnd;
    return `ラウンド${r}敗退組の順位決定戦`;
  }

  // グループ内の全組合せを作る（順不同）
  function buildAllPairs(ids: string[]) {
    const q: Array<{ a: string; b: string }> = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        q.push({ a: ids[i], b: ids[j] });
      }
    }
    return q;
  }

  // 順位決定戦：勝者選択（現在のグループ内）
  const choosePlaceWinner = (winner: string, loser: string) => {
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

  // グループのキューが空になったら、同率が残っていないか確認して追加対戦 or 次のグループへ
  useEffect(() => {
    if (step !== "place") return;
    if (tieQueue.length > 0) return;

    // 現グループの暫定順位
    const subset = tasks.filter((t) => placeCurrent.includes(t.id));
    const { ranking, hasTie, tieGroups } = rankAll(subset, history);

    if (hasTie) {
      // 同率グループだけで再度全組合せを積む
      const q: Array<{ a: string; b: string }> = [];
      tieGroups.forEach((g) => {
        const s = shuffle(g);
        for (let i = 0; i < s.length; i++) {
          for (let j = i + 1; j < s.length; j++) {
            q.push({ a: s[i], b: s[j] });
          }
        }
      });
      if (q.length === 0) {
        // 念のため：何も積めなければ確定とみなす
        finalizeCurrentGroup(ranking.map((t) => t.id));
      } else {
        setTieQueue(q);
      }
      return;
    }

    // 同率が無ければ、このグループの順序を確定
    finalizeCurrentGroup(ranking.map((t) => t.id));
  }, [step, tieQueue.length, placeCurrent, tasks, history]);

  // 現在の敗退組の順位を確定し、次のグループへ or 完了
  function finalizeCurrentGroup(orderedIds: string[]) {
    setFinalOrderIds((prev) => [...prev, ...orderedIds]);

    setPlaceQueue((q) => {
      const rest = q.slice(1);
      if (rest.length === 0) {
        // すべての敗退組が終わったので結果へ
        setStep("result");
        return rest;
      }
      // 次のグループを開始
      const next = rest[0];
      setPlaceCurrent(next);
      setPlaceLabel(labelForGroup(roundIndex, rest, next));
      setTieQueue(buildAllPairs(next));
      return rest;
    });
  }

  const currentPair = pairs[cursor];

  // 表示用（本戦）
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
        </div>
      )}

      {step === "place" && (
        <div>
          <h2 className="text-xl font-semibold mb-1">順位決定戦</h2>
          <p className="text-sm text-gray-600 mb-4">{placeLabel}</p>

          {tieQueue.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => choosePlaceWinner(tieQueue[0].a, tieQueue[0].b)}
                className="rounded-2xl border px-4 py-6 text-left hover:shadow"
              >
                <div className="text-lg font-semibold">
                  {idToTask[tieQueue[0].a]?.title}
                </div>
                <div className="mt-1 text-sm text-gray-600">こちらが上</div>
              </button>
              <button
                onClick={() => choosePlaceWinner(tieQueue[0].b, tieQueue[0].a)}
                className="rounded-2xl border px-4 py-6 text-left hover:shadow"
              >
                <div className="text-lg font-semibold">
                  {idToTask[tieQueue[0].b]?.title}
                </div>
                <div className="mt-1 text-sm text-gray-600">こちらが上</div>
              </button>
            </div>
          ) : (
            <div className="text-sm text-gray-600">グループ内の対戦を集計中…</div>
          )}
        </div>
      )}

      {step === "result" && (
        <div>
          <h2 className="text-xl font-semibold mb-3">優先順位リスト（完全）</h2>
          <ol className="list-decimal pl-5 space-y-1">
            {finalOrderIds.map((id) => (
              <li key={id}>
                <span className="font-medium">{idToTask[id]?.title}</span>{" "}
                <span className="text-xs text-gray-500">
                  (W{safeTotals(history, id).wins}-L{safeTotals(history, id).losses})
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex gap-2">
            <button
              onClick={() => {
                // 本戦から再挑戦（入力は残す）
                const ids = tasks.map((x) => x.id);
                setHistory(initHistory(ids));
                setPairs(seedRound(ids));
                setRoundIndex(1);
                setCursor(0);
                setNextIds([]);
                setLosersByRound({});
                setPlaceQueue([]);
                setPlaceCurrent([]);
                setPlaceLabel("");
                setFinalOrderIds([]);
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
                setLosersByRound({});
                setPlaceQueue([]);
                setPlaceCurrent([]);
                setPlaceLabel("");
                setFinalOrderIds([]);
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
