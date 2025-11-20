// src/features/nudge/techniques/round-robin.tsx
"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

/* ================= 型 ================= */
type Task = { id: string; title: string; createdAt: number };
type Pair = { a: string; b: string };

type History = {
  totals: Record<string, { wins: number; losses: number }>;
  head2head: Record<string, Record<string, number>>; // head2head[a][b] = aがbに勝った数
};

type Marks = Record<string, "maru" | "batsu" | null>; // ○/×/未評価

// 保存用（履歴アーカイブ）
type ArchiveRun = {
  id: string;
  from: string; // YYYY-MM-DD (JST)
  to: string;   // YYYY-MM-DD (JST)
  tasks: Task[]; // 実行時点のタスク（タイトル等含む）
  rankingIds: string[];  // 上から順の Task.id 配列
  history: History;      // 勝敗集計（参考）
  marks: Marks;          // ○×
  createdAt: number;     // 保存日時 (ms)
};
type ArchiveStore = { runs: ArchiveRun[]; version: 1 };

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

/* ================ 手動同期用 定数 ================ */
const LOCAL_KEY = "roundrobin_v1";   // ホーム DOCS の localKey と一致させる
const DOC_KEY = "roundrobin_v1";     // サーバ側 docKey

const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

/* ================ 永続化（履歴 = 同期対象） ================ */
function loadArchive(): ArchiveStore {
  try {
    const raw =
      typeof window !== "undefined" ? localStorage.getItem(LOCAL_KEY) : null;
    if (!raw) return { runs: [], version: 1 };
    const parsed = JSON.parse(raw) as ArchiveStore;
    return parsed?.version ? parsed : { runs: [], version: 1 };
  } catch {
    return { runs: [], version: 1 };
  }
}
function saveArchive(s: ArchiveStore) {
  if (typeof window !== "undefined") {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
  }
}

/* ================ ★ ToDo 下書き保存（ローカル専用） ================ */
type Draft = {
  from: string;
  to: string;
  tasks: Task[];
  version: 1;
  createdAt: number;
};
const RR_DRAFT_KEY = "roundrobin_draft_v1";

function loadDraft(): Draft | null {
  try {
    const raw =
      typeof window !== "undefined" ? localStorage.getItem(RR_DRAFT_KEY) : null;
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d?.version ? d : null;
  } catch {
    return null;
  }
}
function saveDraft(d: Draft) {
  if (typeof window !== "undefined") {
    localStorage.setItem(RR_DRAFT_KEY, JSON.stringify(d));
  }
}
function clearDraft() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(RR_DRAFT_KEY);
  }
}

/* ================ 本体 ================ */
export default function RoundRobin() {
  // 期間（いつからいつまで）— 下書きがあれば復元
  const draft = useRef<Draft | null>(
    typeof window !== "undefined" ? loadDraft() : null
  );

  const [from, setFrom] = useState<string>(() => draft.current?.from ?? today());
  const [to, setTo] = useState<string>(
    () => draft.current?.to ?? plusDays(today(), 7)
  );

  // タスクリスト（ToDo：総当たりへ移るまでは自由編集）
  const [tasks, setTasks] = useState<Task[]>(() => draft.current?.tasks ?? []);
  const [title, setTitle] = useState("");

  // 総当たり用の状態
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<History>(() => initHistory([]));
  const [phase, setPhase] = useState<"input" | "play" | "result">("input");

  // 振り返り（○/×）
  const [marks, setMarks] = useState<Marks>({});

  // 履歴（★サーバと手動同期する対象）
  const [archive, setArchive] = useState<ArchiveStore>(() => loadArchive());
  const archiveRef = useRef<ArchiveStore>(archive);

  const [expandedId, setExpandedId] = useState<string | null>(null); // 履歴の詳細トグル
  const [savedFlag, setSavedFlag] = useState(false); // 今回結果を保存済みか

  const idToTask = useMemo(
    () => Object.fromEntries(tasks.map((t) => [t.id, t])),
    [tasks]
  );

  const validDates = useMemo(() => {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to)
    )
      return false;
    return (
      Date.parse(`${from}T00:00:00+09:00`) <=
      Date.parse(`${to}T23:59:59+09:00`)
    );
  }, [from, to]);

  const canStart = tasks.length >= 2 && validDates;

  // ★タスク数から総当たり試行回数を算出（nC2 = n(n-1)/2）
  const totalTrials = useMemo(
    () => (tasks.length * (tasks.length - 1)) / 2,
    [tasks.length]
  );

  // ----- ★ 履歴のローカル保存（サーバではなく端末のみ） -----
  useEffect(() => {
    archiveRef.current = archive;
    saveArchive(archive);
  }, [archive]);

  // ----- ★ 手動同期の合図を購読（PULL / PUSH / LOCAL_DOC_APPLIED / storage） -----
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<ArchiveStore>(DOC_KEY);
        if (remote && remote.version === 1) {
          setArchive(remote);
          saveArchive(remote);
        }
      } catch (e) {
        console.warn("[round-robin] manual PULL failed:", e);
      }
    };

    const doPush = async () => {
      try {
        await saveUserDoc<ArchiveStore>(DOC_KEY, archiveRef.current);
      } catch (e) {
        console.warn("[round-robin] manual PUSH failed:", e);
      }
    };

    // BroadcastChannel
    let bc: BroadcastChannel | null = null;
    try {
      if ("BroadcastChannel" in window) {
        bc = new BroadcastChannel(SYNC_CHANNEL);
        bc.onmessage = (ev) => {
          const msg = ev?.data;
          if (!msg || typeof msg.type !== "string") return;
          const t = msg.type.toUpperCase();
          if (t.includes("PULL")) doPull();
          else if (t.includes("PUSH")) doPush();
          else if (t.includes("RESET")) {
            // since 未使用なら noop（直後に PULL が来る想定）
          } else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            // ホームが localStorage(localKey) を直接書き換えた合図
            setArchive(loadArchive());
          }
        };
      }
    } catch {
      // noop
    }

    // 同タブ postMessage
    const onWinMsg = (ev: MessageEvent) => {
      const msg = ev?.data;
      if (!msg || typeof msg.type !== "string") return;
      const t = msg.type.toUpperCase();
      if (t.includes("PULL")) doPull();
      else if (t.includes("PUSH")) doPush();
      else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
        setArchive(loadArchive());
      }
    };
    window.addEventListener("message", onWinMsg);

    // 他タブ storage（localKey 変更を拾う）
    const onStorage = (ev: StorageEvent) => {
      if (!ev.key) return;
      if (ev.key === LOCAL_KEY && ev.newValue) {
        try {
          setArchive(JSON.parse(ev.newValue));
        } catch {
          // noop
        }
      }
      if (ev.key === STORAGE_KEY_RESET_REQ) {
        // RESET 自体は noop（直後に PULL が来る前提）
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      try {
        bc?.close();
      } catch {
        // noop
      }
      window.removeEventListener("message", onWinMsg);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // ----- ★ 下書きの自動保存（phase === "input" の間のみ） -----
  useEffect(() => {
    if (phase !== "input") return;
    const d: Draft = { from, to, tasks, version: 1, createdAt: Date.now() };
    saveDraft(d);
  }, [from, to, tasks, phase]);

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
  const removeTask = (id: string) =>
    setTasks((prev) => prev.filter((x) => x.id !== id));
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
    setSavedFlag(false);
    setPhase("play");
    clearDraft(); // ★ 開始時に下書きを破棄
  };

  // 対戦の選択
  const choose = useCallback(
    (winner: string, loser: string) => {
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

  // ---- 履歴保存 ----
  const saveCurrentResult = () => {
    if (phase !== "result" || ranking.length === 0) return;
    if (savedFlag) {
      alert("この結果は保存済みです。");
      return;
    }
    const run: ArchiveRun = {
      id: uid(),
      from,
      to,
      tasks: tasks.slice(), // 当時のタイトル等を保存
      rankingIds: ranking.map((t) => t.id),
      history: JSON.parse(JSON.stringify(history)),
      marks: JSON.parse(JSON.stringify(marks)),
      createdAt: Date.now(),
    };
    const next: ArchiveStore = { version: 1, runs: [run, ...archive.runs] };
    setArchive(next);
    saveArchive(next);
    setSavedFlag(true);
  };

  const deleteRun = (id: string) => {
    const next: ArchiveStore = {
      version: 1,
      runs: archive.runs.filter((r) => r.id !== id),
    };
    setArchive(next);
    saveArchive(next);
    if (expandedId === id) setExpandedId(null);
  };

  const clearAllRuns = () => {
    if (!confirm("履歴をすべて削除します。よろしいですか？")) return;
    const next: ArchiveStore = { version: 1, runs: [] };
    setArchive(next);
    saveArchive(next);
    setExpandedId(null);
  };

  return (
    <div className="rounded-2xl border p-6 shadow-sm grid gap-6">
      {/* === 期間（いつからいつまで） === */}
      <section className="rounded-xl border p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">対象期間</h2>
          {phase === "input" && (
            <button
              onClick={() => {
                clearDraft();
                alert("下書きを削除しました。");
              }}
              className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
              title="自動保存された下書きを削除します"
            >
              下書きを消去
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-xl border px-3 py-2"
            aria-label="開始日"
            disabled={phase !== "input"}
            title={
              phase !== "input" ? "総当たり開始後は編集できません" : ""
            }
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-600">〜</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-xl border px-3 py-2"
            aria-label="終了日"
            disabled={phase !== "input"}
            title={
              phase !== "input" ? "総当たり開始後は編集できません" : ""
            }
          />
          {!(
            Date.parse(`${from}T00:00:00+09:00`) <=
            Date.parse(`${to}T23:59:59+09:00`)
          ) && (
            <span className="text-xs text-red-600">
              開始日は終了日以前にしてください
            </span>
          )}
          {phase !== "input" && (
            <span className="text-xs text-gray-500">※ 期間は確定済みです</span>
          )}
        </div>
        {draft.current && phase === "input" && (
          <p className="mt-2 text-xs text-green-700">
            ✅ 下書きから復元済み（自動保存中）
          </p>
        )}
      </section>

      {/* === ToDo入力（phase: input） === */}
      {phase === "input" && (
        <section className="rounded-xl border p-4">
          <h2 className="text-xl font-semibold mb-3">
            ToDoリスト（開始前は自由に編集）
          </h2>
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
            {tasks.length === 0 && (
              <li className="text-sm text-gray-500">
                まだタスクがありません。
              </li>
            )}
          </ul>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              現在 {tasks.length} 件。
              {" "}
              総当たり試行回数:{" "}
              <span className="tabular-nums font-semibold">
                {totalTrials}
              </span>{" "}
              回。
              <br />
              ※ 2件以上＋期間が有効で開始できます（下書きは自動保存）
            </div>
            <button
              onClick={start}
              disabled={!canStart}
              className="rounded-xl bg-black px-5 py-2 text-white disabled:bg-gray-300"
              title={
                !validDates
                  ? "期間が不正です"
                  : tasks.length < 2
                  ? "タスクが足りません"
                  : ""
              }
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
            <h2 className="text-xl font-semibold mb-1">
              優先順位（総当たり）
            </h2>
            <div className="text-sm text-gray-600 mb-3">
              期間: <span className="tabular-nums">{from}</span> 〜{" "}
              <span className="tabular-nums">{to}</span>
            </div>
            <ol className="list-decimal pl-5 space-y-1">
              {ranking.map((t) => (
                <li key={t.id}>
                  <span className="font-medium">{t.title}</span>{" "}
                  <span className="text-xs text-gray-500">
                    (W{safeTotals(history, t.id).wins}-L
                    {safeTotals(history, t.id).losses})
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={saveCurrentResult}
                className="rounded-xl border px-4 py-2 hover:bg-gray-50"
              >
                {savedFlag ? "✅ 保存済み" : "結果を履歴へ保存"}
              </button>
              <span className="text-sm text-gray-600">
                ※ 保存すると下の「履歴」に追加されます
              </span>
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-2">
              振り返り（期間内に行動できた？）
            </h3>
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
                          mark === "maru"
                            ? "bg-green-600 text-white"
                            : "hover:bg-gray-50"
                        }`}
                        title="○（できた）"
                      >
                        ○
                      </button>
                      <button
                        onClick={() => toggleMark(t.id, "batsu")}
                        className={`rounded-lg border px-3 py-1 text-sm ${
                          mark === "batsu"
                            ? "bg-red-600 text-white"
                            : "hover:bg-gray-50"
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
                setSavedFlag(false);
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
                setSavedFlag(false);
                setPhase("input");
                clearDraft(); // 新規作成なので下書きも消す
              }}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              期間・ToDoから作り直す
            </button>
          </div>
        </section>
      )}

      {/* === 履歴（保存済みの過去の結果） === */}
      <section className="rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">履歴</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">
              {archive.runs.length} 件
            </span>
            {archive.runs.length > 0 && (
              <button
                onClick={clearAllRuns}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              >
                すべて削除
              </button>
            )}
          </div>
        </div>

        {archive.runs.length === 0 ? (
          <p className="text-sm text-gray-500">
            まだ保存された履歴はありません。
          </p>
        ) : (
          <ul className="space-y-3">
            {archive.runs.map((r) => {
              const map = Object.fromEntries(
                r.tasks.map((t) => [t.id, t])
              );
              const top3 = r.rankingIds
                .slice(0, 3)
                .map((id) => map[id]?.title ?? "?");
              const maru = Object.values(r.marks).filter(
                (v) => v === "maru"
              ).length;
              const batu = Object.values(r.marks).filter(
                (v) => v === "batsu"
              ).length;
              const created = new Intl.DateTimeFormat("ja-JP", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                timeZone: "Asia/Tokyo",
              }).format(new Date(r.createdAt));

              const expanded = expandedId === r.id;

              return (
                <li key={r.id} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {r.from} 〜 {r.to}
                      </div>
                      <div className="text-xs text-gray-600">
                        保存: {created} ／ 上位:{" "}
                        {top3.join(" > ")} ／ ○{maru} ×{batu}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() =>
                          setExpandedId(expanded ? null : r.id)
                        }
                        className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                        aria-expanded={expanded}
                      >
                        {expanded ? "閉じる" : "詳細"}
                      </button>
                      <button
                        onClick={() => deleteRun(r.id)}
                        className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-3 border-t pt-3">
                      <h4 className="font-semibold mb-2 text-sm">
                        優先順位・○×
                      </h4>
                      <ol className="list-decimal pl-5 space-y-1">
                        {r.rankingIds.map((id) => {
                          const t = map[id];
                          const m = r.marks[id] ?? null;
                          return (
                            <li key={id} className="flex items-center gap-2">
                              <span className="font-medium">
                                {t?.title ?? "(不明)"}
                              </span>
                              <span className="text-xs text-gray-500">
                                (W{safeTotals(r.history, id).wins}-L
                                {safeTotals(r.history, id).losses})
                              </span>
                              <span className="text-xs">
                                {m === "maru"
                                  ? "○"
                                  : m === "batsu"
                                  ? "×"
                                  : "—"}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
