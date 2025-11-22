// src/features/nudge/techniques/checklist.tsx
"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

/* ========= 型 ========= */
type ID = string;

type Action = {
  id: ID;
  title: string;
  createdAt: number;
  order: number; // 並び順
  isDone?: boolean;
};

type ChecklistSet = {
  id: ID;
  title: string;
  actions: Action[];
  createdAt: number;
};

type ActionLog = {
  actionId: ID;
  startAt: number;
  endAt?: number;
  durationMs?: number; // end時に確定（ローカル保持）
};

type ProcrastinationLog = {
  fromActionId: ID | null;
  startAt: number;
  endAt?: number;
  durationMs?: number;
};

type Run = {
  id: ID;
  setId: ID;
  startedAt: number;
  endedAt?: number;
  actions: ActionLog[];
  procrastinations: ProcrastinationLog[];
};

type Store = {
  sets: ChecklistSet[];
  runs: Run[];
  current?: {
    setId: ID;
    index: number; // 表示中のアクション
    running?: { actionId: ID; startAt: number };
    procrastinating?: { fromActionId: ID | null; startAt: number };
    runId: ID;
  };
  version: 1;
};

/* ========= 手動同期用 定数 ========= */
const LOCAL_KEY = "checklist_v1";
const DOC_KEY = "checklist_v1";

const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

/* ========= ユーティリティ ========= */
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const now = () => Date.now();

function fmtDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hh = h > 0 ? `${h}時間` : "";
  const mm = m > 0 ? `${m}分` : h > 0 && sec > 0 ? "0分" : "";
  const ss = `${sec}秒`;
  return `${hh}${mm}${ss}`;
}

/** localStorage から Store を読み込み（なければ初期値） */
function loadLocal(): Store {
  try {
    if (typeof window === "undefined") {
      return {
        sets: [],
        runs: [],
        version: 1,
      };
    }

    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) {
      // 初期セット（ナイトルーティン例）
      const setId = uid();
      const titles = [
        "夜ご飯待機",
        "夜ご飯",
        "食器を下げる",
        "洗面所に行く",
        "服を脱ぐ",
        "風呂",
        "歯磨き",
        "服を着る",
        "シェイカーに水を入れる",
        "2階に行く",
      ];
      const actions: Action[] = titles.map((t, i) => ({
        id: uid(),
        title: t,
        createdAt: now(),
        order: i,
        isDone: false,
      }));
      return {
        sets: [{ id: setId, title: "ナイトルーティン", actions, createdAt: now() }],
        runs: [],
        current: { setId, index: 0, runId: uid() },
        version: 1,
      };
    }

    const parsed = JSON.parse(raw) as Store;

    // 後方互換（isDoneが未定義の過去データに false を補う）
    const normalized: Store = {
      ...parsed,
      sets: (parsed.sets ?? []).map((s) => ({
        ...s,
        actions: (s.actions ?? []).map((a) => ({ ...a, isDone: a.isDone ?? false })),
      })),
      runs: parsed.runs ?? [],
      version: 1,
    };
    return normalized;
  } catch {
    return { sets: [], runs: [], version: 1 };
  }
}

/** localStorage に保存 */
function saveLocal(store: Store) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
    }
  } catch {
    // 失敗しても無視
  }
}

/* ========= 本体 ========= */
export default function Checklist() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // 再描画（経過表示用）
  const [, setTick] = useState(0);

  // store → localStorage（ローカル即時保存）
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // 手動同期の合図を購読（ホームの📥/☁ と連携）
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<Store>(DOC_KEY);
        if (remote && remote.version === 1) {
          setStore(remote);
          saveLocal(remote);
        }
      } catch (e) {
        console.warn("[checklist] manual PULL failed:", e);
      }
    };

    const doPush = async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, storeRef.current);
      } catch (e) {
        console.warn("[checklist] manual PUSH failed:", e);
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
            // since を使わないのでここは noop（直後の PULL に期待）
          } else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            // ホームが localStorage(LOCAL_KEY) を直接書き換えた合図
            setStore(loadLocal());
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
        setStore(loadLocal());
      }
    };
    window.addEventListener("message", onWinMsg);

    // 他タブ storage（localKey 変更を拾う）
    const onStorage = (ev: StorageEvent) => {
      if (!ev.key) return;
      if (ev.key === LOCAL_KEY && ev.newValue) {
        try {
          const parsed = JSON.parse(ev.newValue) as Store;
          if (parsed && parsed.version === 1) {
            setStore(parsed);
          }
        } catch {
          // noop
        }
      }
      if (ev.key === STORAGE_KEY_RESET_REQ) {
        // ここも since 未使用なので noop（直後の PULL に期待）
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      try {
        bc?.close();
      } catch {}
      window.removeEventListener("message", onWinMsg);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const currentSet = useMemo(() => {
    const id = store.current?.setId;
    return store.sets.find((s) => s.id === id) ?? store.sets[0];
  }, [store.sets, store.current?.setId]);

  const actionsSorted = useMemo(
    () => (currentSet?.actions ?? []).slice().sort((a, b) => a.order - b.order),
    [currentSet]
  );

  const maxIndex = Math.max(0, (actionsSorted.length ?? 1) - 1);
  const index = Math.min(store.current?.index ?? 0, maxIndex);
  const action = actionsSorted[index];

  const running = store.current?.running;
  const procrastinating = store.current?.procrastinating;

  /* ====== セット操作 ====== */
  const addSet = () => {
    const title = prompt("新しいチェックリストのタイトル", "新しいルーティン");
    if (!title) return;
    const newSet: ChecklistSet = {
      id: uid(),
      title,
      actions: [],
      createdAt: now(),
    };
    setStore((s) => ({
      ...s,
      sets: [...s.sets, newSet],
      current: { setId: newSet.id, index: 0, runId: uid() },
    }));
  };

  const renameSet = () => {
    if (!currentSet) return;
    const title = prompt("タイトル変更", currentSet.title);
    if (!title) return;
    setStore((s) => ({
      ...s,
      sets: s.sets.map((x) => (x.id === currentSet.id ? { ...x, title } : x)),
    }));
  };

  const deleteSet = () => {
    if (!currentSet) return;
    if (store.sets.length <= 1) return alert("少なくとも1つのセットが必要です。");
    if (!confirm(`「${currentSet.title}」を削除しますか？`)) return;

    const deletingId = currentSet.id;
    setStore((s) => {
      const nextSets = s.sets.filter((x) => x.id !== deletingId);
      const nextSet = nextSets[0] ?? undefined;
      const nextRuns = s.runs.filter((r) => r.setId !== deletingId);
      return {
        ...s,
        sets: nextSets,
        runs: nextRuns,
        current: nextSet ? { setId: nextSet.id, index: 0, runId: uid() } : undefined,
      };
    });
  };

  /* ====== 行動編集 ====== */
  const addAction = () => {
    if (!currentSet) return;
    const title = prompt("新しい行動名", "新しい行動");
    if (!title) return;

    const newId = uid();
    const order = currentSet.actions.length;

    setStore((s) => ({
      ...s,
      sets: s.sets.map((set) =>
        set.id !== currentSet.id
          ? set
          : {
              ...set,
              actions: [
                ...set.actions,
                { id: newId, title, createdAt: now(), order, isDone: false },
              ],
            }
      ),
    }));
  };

  const renameAction = (id: ID) => {
    const a = currentSet?.actions.find((x) => x.id === id);
    if (!a) return;
    const title = prompt("名称変更", a.title);
    if (!title) return;

    setStore((s) => ({
      ...s,
      sets: s.sets.map((set) =>
        set.id !== currentSet!.id
          ? set
          : {
              ...set,
              actions: set.actions.map((x) => (x.id === id ? { ...x, title } : x)),
            }
      ),
    }));
  };

  const removeAction = (id: ID) => {
    if (!currentSet) return;
    if (!confirm("この行動を削除しますか？")) return;

    setStore((s) => {
      const targetSet = s.sets.find((st) => st.id === currentSet.id);
      if (!targetSet) return s;

      const filteredActions = targetSet.actions.filter((x) => x.id !== id);
      const reOrdered = filteredActions.map((x, i) => ({ ...x, order: i }));

      const nextSets = s.sets.map((st) =>
        st.id !== currentSet.id ? st : { ...st, actions: reOrdered }
      );

      const nextCurrent =
        s.current?.setId === currentSet.id
          ? { ...s.current, index: 0 }
          : s.current;

      // 該当行動を含むランから、その actionId を抜く
      const nextRuns = s.runs.map((r) =>
        r.setId !== currentSet.id
          ? r
          : {
              ...r,
              actions: r.actions.filter((al) => al.actionId !== id),
            }
      );

      return { ...s, sets: nextSets, current: nextCurrent, runs: nextRuns };
    });
  };

  const moveAction = (id: ID, dir: -1 | 1) => {
    if (!currentSet) return;
    const list = actionsSorted;
    nextTick: {
      const idx = list.findIndex((x) => x.id === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= list.length) break nextTick;

      const swapped = list.slice();
      const tmp = swapped[idx];
      swapped[idx] = swapped[j];
      swapped[j] = tmp;

      setStore((s) => ({
        ...s,
        sets: s.sets.map((set) =>
          set.id !== currentSet.id
            ? set
            : { ...set, actions: swapped.map((x, k) => ({ ...x, order: k })) }
        ),
        current:
          s.current?.setId === currentSet.id ? { ...s.current, index: j } : s.current,
      }));
    }
  };

  /* ====== ページ移動 ====== */
  const go = (i: number) =>
    setStore((s) => ({
      ...s,
      current: s.current
        ? {
            ...s.current,
            index: Math.max(
              0,
              Math.min(i, Math.max(0, (currentSet?.actions.length ?? 1) - 1))
            ),
          }
        : s.current,
    }));

  const onChangeSet = (setId: ID) => {
    setStore((s) => ({
      ...s,
      current: { setId, index: 0, runId: uid() },
    }));
  };

  const prev = () => go(index - 1);
  const next = () => go(index + 1);

  /* ====== 実行（全体開始／開始／終了／先延ばし） ====== */
  const ensureRun = (): Run => {
    const cur = store.current!;
    const ex = store.runs.find((r) => r.id === cur.runId);
    if (ex) return ex;
    const run: Run = {
      id: cur.runId,
      setId: cur.setId,
      startedAt: now(),
      actions: [],
      procrastinations: [],
    };
    setStore((s) => ({ ...s, runs: [run, ...s.runs] }));
    return run;
  };

  // チェックリスト全体の開始
  const startChecklist = () => {
    if (!currentSet || actionsSorted.length === 0) {
      alert("先に行動を追加してください。");
      return;
    }
    if (store.current?.procrastinating || store.current?.running) return;

    ensureRun();
    setStore((s) => ({
      ...s,
      current: {
        ...(s.current as NonNullable<Store["current"]>),
        index: 0,
        procrastinating: { fromActionId: null, startAt: now() },
      },
    }));
  };

  // チェックリスト全体を終了
  const endChecklist = () => {
    const endedAt = now();

    setStore((prev) => {
      if (!prev.current) return prev;
      const cur = prev.current;
      const runId = cur.runId;

      const runs = prev.runs.map((r) => {
        if (r.id !== runId) return r;
        const next = { ...r };

        if (cur.running) {
          const i = next.actions.findIndex(
            (l) => l.actionId === cur.running!.actionId && !l.endAt
          );
          if (i >= 0) {
            const log = next.actions[i];
            next.actions[i] = {
              ...log,
              endAt: endedAt,
              durationMs: endedAt - log.startAt,
            };
          }
        }
        if (cur.procrastinating) {
          next.procrastinations = [
            ...next.procrastinations,
            {
              fromActionId: cur.procrastinating.fromActionId,
              startAt: cur.procrastinating.startAt,
              endAt: endedAt,
              durationMs: endedAt - cur.procrastinating.startAt,
            },
          ];
        }
        next.endedAt = endedAt;
        return next;
      });

      return {
        ...prev,
        runs,
        current: { ...cur, running: undefined, procrastinating: undefined },
      };
    });
  };

  // 行動を開始
  const startAction = (a: Action) => {
    const p = store.current?.procrastinating;
    if (p) {
      const endedAt = now();
      const duration = endedAt - p.startAt;
      setStore((s) => ({
        ...s,
        runs: s.runs.map((r) =>
          r.id !== s.current!.runId
            ? r
            : {
                ...r,
                procrastinations: [
                  ...r.procrastinations,
                  {
                    fromActionId: p.fromActionId,
                    startAt: p.startAt,
                    endAt: endedAt,
                    durationMs: duration,
                  },
                ],
              }
        ),
        current: { ...s.current!, procrastinating: undefined },
      }));
    }

    if (running && running.actionId !== a.id) endActionInternal(running.actionId);

    ensureRun();
    const t = now();
    setStore((s) => ({
      ...s,
      // 画面上の isDone を false に（開始＝未了）
      sets: s.sets.map((set) =>
        set.id !== currentSet!.id
          ? set
          : {
              ...set,
              actions: set.actions.map((x) =>
                x.id === a.id ? { ...x, isDone: false } : x
              ),
            }
      ),
      current: { ...s.current!, running: { actionId: a.id, startAt: t } },
      runs: s.runs.map((r) =>
        r.id !== s.current!.runId
          ? r
          : { ...r, actions: [...r.actions, { actionId: a.id, startAt: t }] }
      ),
    }));
  };

  // 行動を「先延ばしへ」
  const procrastinateNow = () => {
    const endedAt = now();

    setStore((prev) => {
      const cur = prev.current;
      if (!cur || !cur.running) return prev;

      const actionId = cur.running.actionId;
      const runId = cur.runId;

      const runs = prev.runs.map((r) => {
        if (r.id !== runId) return r;
        const logs = r.actions.slice();
        const i = logs.findIndex((l) => l.actionId === actionId && !l.endAt);
        if (i >= 0) {
          const log = logs[i];
          logs[i] = { ...log, endAt: endedAt, durationMs: endedAt - log.startAt };
        }
        return { ...r, actions: logs };
      });

      return {
        ...prev,
        runs,
        current: {
          ...cur,
          running: undefined,
          procrastinating: { fromActionId: actionId, startAt: endedAt },
        },
      };
    });
  };

  // 終了：最後の行動ならラン終了／それ以外は次の行動までの先延ばしを開始
  const endActionInternal = (actionId: ID) => {
    const endedAt = now();

    setStore((prev) => {
      if (!prev.current) return prev;

      const cur = prev.current;
      const runId = cur.runId;

      const setForCalc = prev.sets.find((s) => s.id === cur.setId);
      const total = setForCalc ? setForCalc.actions.length : 0;
      const isLast = (cur.index ?? 0) >= Math.max(0, total - 1);

      const runs = prev.runs.map((run) => {
        if (run.id !== runId) return run;
        const next = { ...run };

        const logs = next.actions.slice();
        const i = logs.findIndex((l) => l.actionId === actionId && !l.endAt);
        if (i >= 0) {
          const log = logs[i];
          logs[i] = { ...log, endAt: endedAt, durationMs: endedAt - log.startAt };
        }
        next.actions = logs;

        if (isLast) {
          next.endedAt = endedAt;
        }

        return next;
      });

      // 終了したアクションを isDone=true に
      const nextSets = prev.sets.map((set) =>
        set.id !== cur.setId
          ? set
          : {
              ...set,
              actions: set.actions.map((a) =>
                a.id === actionId ? { ...a, isDone: true } : a
              ),
            }
      );

      if (isLast) {
        return {
          ...prev,
          sets: nextSets,
          runs,
          current: { ...cur, running: undefined, procrastinating: undefined },
        };
      }

      const nextIndex = Math.min(
        (cur.index ?? 0) + 1,
        Math.max(0, (total ?? 1) - 1)
      );
      return {
        ...prev,
        sets: nextSets,
        runs,
        current: {
          ...cur,
          index: nextIndex,
          running: undefined,
          procrastinating: { fromActionId: actionId, startAt: endedAt },
        },
      };
    });
  };

  const endAction = () => {
    if (!running) return;
    endActionInternal(running.actionId);
  };

  const runningElapsedMs = running ? now() - running.startAt : 0;
  const procrastElapsedMs = procrastinating ? now() - procrastinating.startAt : 0;

  /* ====== UI ====== */
  return (
    <div className="space-y-4">
      {/* セット切替/操作 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">チェックリスト：</label>
          <select
            value={currentSet?.id ?? ""}
            onChange={(e) => onChangeSet(e.target.value as ID)}
            className="rounded-xl border px-3 py-2"
          >
            {store.sets
              .slice()
              .sort((a, b) => a.createdAt - b.createdAt)
              .map((set) => (
                <option key={set.id} value={set.id}>
                  {set.title}
                </option>
              ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={addSet}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            新規セット
          </button>
          <button
            onClick={renameSet}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            タイトル変更
          </button>
          <button
            onClick={deleteSet}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            セット削除
          </button>
        </div>
      </div>

      {/* チェックリスト全体開始/終了 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">チェックリストの開始/終了</h3>
            <p className="text-xs text-gray-500">
              「開始」は1番目の行動を始めるまでを先延ばしとして計測。「終了」は実行中/先延ばしを確定してこのランを閉じます。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={startChecklist}
              disabled={!!procrastinating || !!running || actionsSorted.length === 0}
              className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-40"
            >
              チェックリスト開始
            </button>
            <button
              onClick={endChecklist}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
              title="実行中の行動/先延ばしをクローズしてこのランを終了します"
            >
              チェックリスト終了
            </button>
          </div>
        </div>

        {!running && procrastinating && procrastinating.fromActionId === null && (
          <div className="mt-2 text-sm text-red-600">
            先延ばし中：{fmtDuration(procrastElapsedMs)}（1番目の行動を開始すると確定）
          </div>
        )}
      </section>

      {/* ページャ */}
      <div className="flex items-center justify-between">
        <button
          onClick={prev}
          disabled={index <= 0}
          className="rounded-xl border px-3 py-2 hover:bg-gray-50 disabled:opacity-40"
        >
          ← 前へ
        </button>
        <div className="text-sm text-gray-600">
          {index + 1} / {actionsSorted.length || 1}
        </div>
        <button
          onClick={next}
          disabled={index >= maxIndex}
          className="rounded-xl border px-3 py-2 hover:bg-gray-50 disabled:opacity-40"
        >
          次へ →
        </button>
      </div>

      {/* 行動カード（1ページ=1行動） */}
      <section className="rounded-2xl border p-4 shadow-sm">
        {action ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-semibold break-words">
                {action.title}
                {action.isDone ? (
                  <span className="ml-2 text-xs text-green-600 align-middle">
                    （完了）
                  </span>
                ) : null}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => moveAction(action.id, -1)}
                  className="rounded-lg border px-2 py-1 text-sm"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveAction(action.id, +1)}
                  className="rounded-lg border px-2 py-1 text-sm"
                >
                  ↓
                </button>
                <button
                  onClick={() => renameAction(action.id)}
                  className="rounded-lg border px-2 py-1 text-sm"
                >
                  名称変更
                </button>
                <button
                  onClick={() => removeAction(action.id)}
                  className="rounded-lg border px-2 py-1 text-sm"
                >
                  削除
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {!running || running.actionId !== action.id ? (
                <button
                  onClick={() => startAction(action)}
                  className="rounded-xl bg-black text-white px-5 py-3"
                >
                  開始
                </button>
              ) : (
                <>
                  <button
                    onClick={endAction}
                    className="rounded-xl border px-5 py-3 hover:bg-gray-50"
                  >
                    終了
                  </button>
                  <button
                    onClick={procrastinateNow}
                    className="rounded-xl border px-5 py-3 hover:bg-gray-50"
                    title="この行動を一旦終了し、この行動の直前先延ばしに戻ります"
                  >
                    先延ばしへ
                  </button>
                </>
              )}

              {/* 状態表示 */}
              {running && running.actionId === action.id && (
                <span className="text-sm text-gray-700">
                  進行中：{fmtDuration(runningElapsedMs)}
                </span>
              )}
              {!running && procrastinating && procrastinating.fromActionId !== null && (
                <span className="text-sm text-red-600">
                  先延ばし中：{fmtDuration(procrastElapsedMs)}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-500">
            行動がありません。まずは「行動を追加」を押してください。
          </div>
        )}
      </section>

      {/* 行動一覧（編集用） */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">行動一覧</h3>
          <button
            onClick={addAction}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            行動を追加
          </button>
        </div>
        {actionsSorted.length === 0 ? (
          <p className="text-sm text-gray-500">まだ行動がありません。</p>
        ) : (
          <ol className="space-y-1 list-decimal pl-5">
            {actionsSorted.map((a, i) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3"
              >
                <button
                  onClick={() => go(i)}
                  className="text-left underline-offset-2 hover:underline min-w-0 break-words"
                >
                  {a.title}
                  {a.isDone ? "（完了）" : ""}
                </button>
                <div className="flex gap-1">
                  <button
                    onClick={() => moveAction(a.id, -1)}
                    className="rounded-lg border px-2 py-1 text-xs"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveAction(a.id, +1)}
                    className="rounded-lg border px-2 py-1 text-xs"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => renameAction(a.id)}
                    className="rounded-lg border px-2 py-1 text-xs"
                  >
                    名
                  </button>
                  <button
                    onClick={() => removeAction(a.id)}
                    className="rounded-lg border px-2 py-1 text-xs"
                  >
                    削
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
