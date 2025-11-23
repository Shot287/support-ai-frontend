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
  /** この行動で意識することのメモ欄 */
  memo?: string;
  /** 目標時間（秒単位）。UI では mm:ss で編集。*/
  targetSec?: number;
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
  /** この試行が目標時間内なら true, 超過なら false, 目標なし等なら undefined */
  success?: boolean;
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
/**
 * ✅ 互換モード:
 *   - "checklist_v1" と "nudge_checklist_v1" のどちらの docKey でも同期できるようにする
 *   - DOCS 側がどちらでも、ここから両方に PUSH / どちらかから PULL する
 */
const DOC_KEYS = ["checklist_v1", "nudge_checklist_v1"] as const;

const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

/* ========= ユーティリティ ========= */
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const now = () => Date.now();

/**
 * ○時間○分○秒 表記
 * - 負の値は 0 とみなす
 * - 必ず 3単位すべて表示（0時間0分30秒 など）
 */
function fmtDuration(ms: number) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}時間${m}分${s}秒`;
}

/** targetSec(秒) → "mm:ss" 文字列 */
function formatMmSsFromSec(sec?: number): string {
  if (sec == null) return "";
  const t = Math.max(0, Math.round(sec));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** "mm:ss" → 秒（不正な形式なら null） */
function parseMmSs(text: string): number | null {
  const trimmed = text.trim();
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(trimmed);
  if (!m) return null;
  const min = parseInt(m[1], 10);
  const sec = parseInt(m[2], 10);
  return min * 60 + sec;
}

/** 目標時間に基づき成功判定を行う（目標なしなら undefined） */
function calcSuccessFor(
  store: Store,
  setId: ID,
  actionId: ID,
  durationMs: number
): boolean | undefined {
  const set = store.sets.find((s) => s.id === setId);
  const action = set?.actions.find((a) => a.id === actionId);
  const targetSec = action?.targetSec;
  if (targetSec == null) return undefined;
  const targetMs = targetSec * 1000;
  return durationMs <= targetMs;
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
        memo: "",
        targetSec: undefined,
      }));
      return {
        sets: [{ id: setId, title: "ナイトルーティン", actions, createdAt: now() }],
        runs: [],
        current: { setId, index: 0, runId: uid() },
        version: 1,
      };
    }

    const parsed = JSON.parse(raw) as Store;

    // 後方互換（memo/targetSec/success だけ補正。isDone は無視して放置）
    const normalized: Store = {
      ...parsed,
      sets: (parsed.sets ?? []).map((s) => ({
        ...s,
        actions: (s.actions ?? []).map((a: any) => ({
          ...a,
          memo: a.memo ?? "",
          targetSec:
            typeof a.targetSec === "number" && !Number.isNaN(a.targetSec)
              ? a.targetSec
              : undefined,
        })),
      })),
      runs: (parsed.runs ?? []).map((r) => ({
        ...r,
        actions: (r.actions ?? []).map((al: any) => ({
          ...al,
          success:
            typeof al.success === "boolean" ? al.success : undefined,
        })),
      })),
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

  // ==== 共通: サーバからの PULL / サーバへの PUSH ==== //
  const pullFromServer = async () => {
    // どちらか一方でも見つかればそれを採用
    for (const key of DOC_KEYS) {
      try {
        const remote = await loadUserDoc<Store>(key);
        if (remote && typeof remote === "object") {
          const normalized: Store = {
            ...remote,
            sets: (remote.sets ?? []).map((s) => ({
              ...s,
              actions: (s.actions ?? []).map((a: any) => ({
                ...a,
                memo: a.memo ?? "",
                targetSec:
                  typeof a.targetSec === "number" &&
                  !Number.isNaN(a.targetSec)
                    ? a.targetSec
                    : undefined,
              })),
            })),
            runs: (remote.runs ?? []).map((r) => ({
              ...r,
              actions: (r.actions ?? []).map((al: any) => ({
                ...al,
                success:
                  typeof al.success === "boolean" ? al.success : undefined,
              })),
            })),
            version: 1,
          };
          setStore(normalized);
          saveLocal(normalized);
          return;
        }
      } catch (e) {
        console.warn(`[checklist] PULL failed for docKey=${key}:`, e);
      }
    }
  };

  const pushToServer = async () => {
    const snapshot = storeRef.current;
    for (const key of DOC_KEYS) {
      try {
        await saveUserDoc<Store>(key, snapshot);
      } catch (e) {
        console.warn(`[checklist] PUSH failed for docKey=${key}:`, e);
      }
    }
  };

  // 手動同期の合図を購読（ホームの📥/☁ と連携）
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = () => {
      void pullFromServer();
    };

    const doPush = () => {
      void pushToServer();
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
          } else if (
            t === LOCAL_APPLIED_TYPE &&
            msg.docKey &&
            DOC_KEYS.includes(msg.docKey)
          ) {
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
      else if (
        t === LOCAL_APPLIED_TYPE &&
        msg.docKey &&
        DOC_KEYS.includes(msg.docKey)
      ) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // pullFromServer/pushToServer は内部で state を参照しないので依存なしでOK

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const currentSet = useMemo(() => {
    const id = store.current?.setId;
    return store.sets.find((s) => s.id === id) ?? store.sets[0];
  }, [store.sets, store.current?.setId]);

  const actionsSorted = useMemo(
    () =>
      (currentSet?.actions ?? [])
        .slice()
        .sort((a, b) => a.order - b.order),
    [currentSet]
  );

  const maxIndex = Math.max(0, (actionsSorted.length ?? 1) - 1);
  const index = Math.min(store.current?.index ?? 0, maxIndex);
  const action = actionsSorted[index];

  const running = store.current?.running;
  const procrastinating = store.current?.procrastinating;

  // 目標時間合計（targetSec が設定されている行動のみ）
  const totalTargetMs = useMemo(() => {
    if (!currentSet) return 0;
    return (currentSet.actions ?? []).reduce((sum, a) => {
      if (typeof a.targetSec === "number" && !Number.isNaN(a.targetSec)) {
        return sum + a.targetSec * 1000;
      }
      return sum;
    }, 0);
  }, [currentSet]);

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
    if (store.sets.length <= 1)
      return alert("少なくとも1つのセットが必要です。");
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
        current: nextSet
          ? { setId: nextSet.id, index: 0, runId: uid() }
          : undefined,
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
                {
                  id: newId,
                  title,
                  createdAt: now(),
                  order,
                  memo: "",
                  targetSec: undefined,
                },
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
              actions: set.actions.map((x) =>
                x.id === id ? { ...x, title } : x
              ),
            }
      ),
    }));
  };

  /** メモ更新用 */
  const updateActionMemo = (id: ID, memo: string) => {
    if (!currentSet) return;
    setStore((s) => ({
      ...s,
      sets: s.sets.map((set) =>
        set.id !== currentSet.id
          ? set
          : {
              ...set,
              actions: set.actions.map((a) =>
                a.id === id ? { ...a, memo } : a
              ),
            }
      ),
    }));
  };

  /** 目標時間更新用（秒） */
  const updateActionTargetSec = (id: ID, sec: number | undefined) => {
    if (!currentSet) return;
    setStore((s) => ({
      ...s,
      sets: s.sets.map((set) =>
        set.id !== currentSet.id
          ? set
          : {
              ...set,
              actions: set.actions.map((a) =>
                a.id === id ? { ...a, targetSec: sec } : a
              ),
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
          s.current?.setId === currentSet.id
            ? { ...s.current, index: j }
            : s.current,
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
            const duration = endedAt - log.startAt;
            const success = calcSuccessFor(
              prev,
              cur.setId,
              cur.running!.actionId,
              duration
            );
            next.actions[i] = {
              ...log,
              endAt: endedAt,
              durationMs: duration,
              success,
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
      current: { ...s.current!, running: { actionId: a.id, startAt: t } },
      runs: s.runs.map((r) =>
        r.id !== s.current!.runId
          ? r
          : {
              ...r,
              actions: [...r.actions, { actionId: a.id, startAt: t }],
            }
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
          const duration = endedAt - log.startAt;
          const success = calcSuccessFor(prev, cur.setId, actionId, duration);
          logs[i] = {
            ...log,
            endAt: endedAt,
            durationMs: duration,
            success,
          };
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
          const duration = endedAt - log.startAt;
          const success = calcSuccessFor(prev, cur.setId, actionId, duration);
          logs[i] = {
            ...log,
            endAt: endedAt,
            durationMs: duration,
            success,
          };
        }
        next.actions = logs;

        if (isLast) {
          next.endedAt = endedAt;
        }

        return next;
      });

      if (isLast) {
        return {
          ...prev,
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
  const procrastElapsedMs = procrastinating
    ? now() - procrastinating.startAt
    : 0;

  /* ====== 目標時間入力（現在表示中の action 用のローカル状態） ====== */
  const [targetInput, setTargetInput] = useState<string>("");

  useEffect(() => {
    // ページ切り替え時などに、現在の action.targetSec から入力欄をリセット
    setTargetInput(formatMmSsFromSec(action?.targetSec));
  }, [action?.id, action?.targetSec]);

  const applyTargetInput = () => {
    if (!action) return;
    const trimmed = targetInput.trim();
    if (trimmed === "") {
      // 目標時間なし
      updateActionTargetSec(action.id, undefined);
      return;
    }
    const sec = parseMmSs(trimmed);
    if (sec == null) {
      alert("目標時間は mm:ss 形式で入力してください（例: 02:00）");
      setTargetInput(formatMmSsFromSec(action.targetSec));
      return;
    }
    updateActionTargetSec(action.id, sec);
    // 正規化された表示に更新
    setTargetInput(formatMmSsFromSec(sec));
  };

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
              disabled={
                !!procrastinating || !!running || actionsSorted.length === 0
              }
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

        {!running &&
          procrastinating &&
          procrastinating.fromActionId === null && (
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
              {!running &&
                procrastinating &&
                procrastinating.fromActionId !== null && (
                  <span className="text-sm text-red-600">
                    先延ばし中：{fmtDuration(procrastElapsedMs)}
                  </span>
                )}
            </div>

            {/* メモ欄 */}
            <div className="mt-4">
              <label className="block text-sm text-gray-600 mb-1">
                メモ（この行動で意識すること）
              </label>
              <textarea
                value={action.memo ?? ""}
                onChange={(e) => updateActionMemo(action.id, e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm min-h-[72px]"
                placeholder="例：急がず丁寧に／姿勢を意識する など"
              />
            </div>

            {/* 目標時間入力欄（mm:ss） */}
            <div className="mt-4">
              <label className="block text-sm text-gray-600 mb-1">
                目標時間（mm:ss）
              </label>
              <input
                type="text"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                onBlur={applyTargetInput}
                className="w-32 rounded-xl border px-3 py-2 text-sm tabular-nums"
                placeholder="例: 02:00"
              />
              <p className="mt-1 text-xs text-gray-500">
                例: 02:00 なら 2分。空欄にするとこの行動には目標時間を設定しません。
              </p>
            </div>

            {/* 目標時間合計（チェックリスト全体） */}
            <div className="mt-6 border-t pt-3 text-sm text-gray-700">
              <div className="flex items-center justify-between">
                <span>このチェックリストの目標時間合計</span>
                <span className="tabular-nums font-medium">
                  {totalTargetMs > 0 ? fmtDuration(totalTargetMs) : "—"}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                ※ 目標時間が設定されている行動のみの合計です。
              </p>
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
          <ol className="space-y-2 list-decimal pl-5">
            {actionsSorted.map((a, i) => (
              <li key={a.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={() => go(i)}
                    className="text-left underline-offset-2 hover:underline min-w-0 break-words"
                  >
                    {a.title}
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
                </div>
                {a.memo && (
                  <p className="ml-1 text-xs text-gray-500 whitespace-pre-line break-words">
                    メモ: {a.memo}
                  </p>
                )}
                {typeof a.targetSec === "number" && (
                  <p className="ml-1 text-xs text-gray-500">
                    目標時間: {formatMmSsFromSec(a.targetSec)}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
