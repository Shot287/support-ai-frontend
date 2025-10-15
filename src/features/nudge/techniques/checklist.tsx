// src/features/nudge/techniques/checklist.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* ========= 型 ========= */
type ID = string;

type Action = {
  id: ID;
  title: string;
  createdAt: number;
  order: number;
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
  durationMs?: number;
};

type ProcrastinationLog = {
  fromActionId: ID | null;
  startAt: number;
  endAt?: number;
  durationMs?: number;
};

type DeviationLog = {
  actionId: ID;
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
  deviations: DeviationLog[];
};

type Store = {
  sets: ChecklistSet[];
  runs: Run[];
  current?: {
    setId: ID;
    index: number;
    running?: { actionId: ID; startAt: number };
    procrastinating?: { fromActionId: ID | null; startAt: number };
    deviating?: { actionId: ID; startAt: number };
    runId: ID;
  };
  version: 1;
};

/* ========= ユーティリティ ========= */
const KEY = "checklist_v1";

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const now = () => Date.now();

function fmtDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hh = h > 0 ? `${h}時間` : "";
  const mm = m > 0 ? `${m}分` : (h > 0 && sec > 0 ? "0分" : "");
  const ss = `${sec}秒`;
  return `${hh}${mm}${ss}`;
}

function load(): Store {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) {
      const setId = uid();
      const titles = [
        "夜ご飯待機","夜ご飯","食器を下げる","洗面所に行く","服を脱ぐ",
        "風呂","歯磨き","服を着る","シェイカーに水を入れる","2階に行く",
      ];
      const actions: Action[] = titles.map((t, i) => ({
        id: uid(), title: t, createdAt: now(), order: i,
      }));
      return {
        sets: [{ id: setId, title: "ナイトルーティン", actions, createdAt: now() }],
        runs: [],
        current: { setId, index: 0, runId: uid() },
        version: 1,
      };
    }
    const parsed = JSON.parse(raw) as Store;
    return parsed?.version ? parsed : { sets: [], runs: [], version: 1 };
  } catch {
    return { sets: [], runs: [], version: 1 };
  }
}

function save(s: Store) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s));
}

/* ========= 本体 ========= */
export default function Checklist() {
  const [store, setStore] = useState<Store>(() => load());
  useEffect(() => save(store), [store]);

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
  const deviating = store.current?.deviating;

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  /* ====== セット操作 ====== */
  const addSet = () => {
    const title = prompt("新しいチェックリストのタイトル", "新しいルーティン");
    if (!title) return;
    const newSet: ChecklistSet = { id: uid(), title, actions: [], createdAt: now() };
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
    setStore((s) => {
      const nextSets = s.sets.filter((x) => x.id !== currentSet.id);
      const nextSet = nextSets[0];
      return {
        ...s,
        sets: nextSets,
        current: { setId: nextSet.id, index: 0, runId: uid() },
      };
    });
  };

  /* ====== 行動編集 ====== */
  const addAction = () => {
    if (!currentSet) return;
    const title = prompt("新しい行動名", "新しい行動");
    if (!title) return;
    setStore((s) => ({
      ...s,
      sets: s.sets.map((set) =>
        set.id !== currentSet.id
          ? set
          : {
              ...set,
              actions: [
                ...set.actions,
                { id: uid(), title, createdAt: now(), order: set.actions.length },
              ],
            }
      ),
    }));
  };

  const moveAction = (id: ID, dir: -1 | 1) => {
    if (!currentSet) return;
    const list = actionsSorted;
    const idx = list.findIndex((x) => x.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= list.length) return;
    const swapped = list.slice();
    [swapped[idx], swapped[j]] = [swapped[j], swapped[idx]];
    setStore((s) => ({
      ...s,
      sets: s.sets.map((set) =>
        set.id !== currentSet.id
          ? set
          : { ...set, actions: swapped.map((x, k) => ({ ...x, order: k })) }
      ),
      current:
        s.current?.setId === currentSet.id ? { ...s.current!, index: j } : s.current,
    }));
  };

  /* ====== ラン確保 ====== */
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
      deviations: [],
    };
    setStore((s) => ({ ...s, runs: [run, ...s.runs] }));
    return run;
  };

  /* ====== 全体終了 ====== */
  const endChecklist = () => {
    const endedAt = now();
    setStore((prev) => {
      if (!prev.current) return prev;
      const cur = prev.current;
      const runId = cur.runId;
      const runs = prev.runs.map((r) => {
        if (r.id !== runId) return r;
        const next = { ...r };
        if (cur.deviating)
          next.deviations.push({
            actionId: cur.deviating.actionId,
            startAt: cur.deviating.startAt,
            endAt: endedAt,
            durationMs: endedAt - cur.deviating.startAt,
          });
        if (cur.running) {
          const logs = next.actions.slice();
          const i = logs.findIndex((l) => l.actionId === cur.running!.actionId && !l.endAt);
          if (i >= 0)
            logs[i] = {
              ...logs[i],
              endAt: endedAt,
              durationMs: endedAt - logs[i].startAt,
            };
          next.actions = logs;
        }
        if (cur.procrastinating)
          next.procrastinations.push({
            fromActionId: cur.procrastinating.fromActionId,
            startAt: cur.procrastinating.startAt,
            endAt: endedAt,
            durationMs: endedAt - cur.procrastinating.startAt,
          });
        next.endedAt = endedAt;
        return next;
      });
      return {
        ...prev,
        runs,
        current: { ...cur, running: undefined, procrastinating: undefined, deviating: undefined },
      };
    });
  };

  /* ====== 行動終了 ====== */
  const endActionInternal = (actionId: ID) => {
    const endedAt = now();
    setStore((prev) => {
      if (!prev.current) return prev;
      const cur = prev.current;
      const runId = cur.runId;
      const runs = prev.runs.map((r) => {
        if (r.id !== runId) return r;
        const next = { ...r };
        if (cur.deviating && cur.deviating.actionId === actionId)
          next.deviations.push({
            actionId,
            startAt: cur.deviating.startAt,
            endAt: endedAt,
            durationMs: endedAt - cur.deviating.startAt,
          });
        const logs = next.actions.slice();
        const i = logs.findIndex((l) => l.actionId === actionId && !l.endAt);
        if (i >= 0)
          logs[i] = {
            ...logs[i],
            endAt: endedAt,
            durationMs: endedAt - logs[i].startAt,
          };
        next.actions = logs;
        return next;
      });
      return {
        ...prev,
        runs,
        current: {
          ...cur,
          running: undefined,
          procrastinating: { fromActionId: actionId, startAt: endedAt },
          deviating:
            cur.deviating && cur.deviating.actionId === actionId ? undefined : cur.deviating,
        },
      };
    });
  };

  /* ====== 逸脱安全化（cur.runningがundefinedの可能性対策） ====== */
  const toggleDeviation = () => {
    setStore((prev) => {
      if (!prev.current || !prev.current.running) {
        alert("逸脱は行動中のみ記録できます。");
        return prev;
      }
      const cur = prev.current;
      const runId = cur.runId;
      if (cur.deviating) {
        const endedAt = now();
        const runs = prev.runs.map((r) =>
          r.id !== runId
            ? r
            : {
                ...r,
                deviations: [
                  ...r.deviations,
                  {
                    actionId: cur.deviating!.actionId,
                    startAt: cur.deviating!.startAt,
                    endAt: endedAt,
                    durationMs: endedAt - cur.deviating!.startAt,
                  },
                ],
              }
        );
        return { ...prev, runs, current: { ...cur, deviating: undefined } };
      }

      // ✅ 修正：型ガードを追加
      if (!cur.running) return prev;

      return {
        ...prev,
        current: {
          ...cur,
          deviating: { actionId: cur.running.actionId, startAt: now() },
        },
      };
    });
  };

  const runningElapsedMs = running ? now() - running.startAt : 0;
  const procrastElapsedMs = procrastinating ? now() - procrastinating.startAt : 0;
  const deviationElapsedMs = deviating ? now() - deviating.startAt : 0;

  /* ====== UI ====== */
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border p-4 shadow-sm">
        <h3 className="font-semibold">チェックリスト</h3>
        <div className="flex gap-2 mt-2">
          <button onClick={endChecklist} className="rounded-xl border px-4 py-2 hover:bg-gray-50">
            チェックリスト終了
          </button>
        </div>
      </section>

      <section className="rounded-2xl border p-4 shadow-sm">
        {action ? (
          <>
            <h2 className="text-xl font-semibold">{action.title}</h2>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() => endActionInternal(action.id)}
                className="rounded-xl border px-5 py-3 hover:bg-gray-50"
              >
                終了
              </button>
              <button
                onClick={toggleDeviation}
                className={`rounded-xl px-5 py-3 ${
                  deviating ? "bg-red-600 text-white" : "border hover:bg-gray-50"
                }`}
              >
                {deviating ? "逸脱終了" : "逸脱開始"}
              </button>
              {running && (
                <span className="text-sm text-gray-700">
                  進行中：{fmtDuration(runningElapsedMs)}
                </span>
              )}
              {procrastinating && (
                <span className="text-sm text-red-600">
                  先延ばし中：{fmtDuration(procrastElapsedMs)}
                </span>
              )}
              {deviating && (
                <span className="text-sm text-red-700">
                  逸脱中：{fmtDuration(deviationElapsedMs)}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-500">行動がありません。</div>
        )}
      </section>
    </div>
  );
}
