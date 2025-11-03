// src/features/nudge/techniques/checklist.tsx
"use client";

import { useEffect, useMemo, useState, useRef } from "react";

// 手動同期ユーティリティ
import {
  pullBatch,
  upsertChecklistSet,
  upsertChecklistAction,
  deleteChecklistAction,
  pushBatch,
  type ChecklistSetRow,
  type ChecklistActionRow,
} from "@/lib/sync";
import { subscribeGlobalPush } from "@/lib/sync-bus";
import { getDeviceId } from "@/lib/device";

/* ========= 型 ========= */
type ID = string;

type Action = {
  id: ID;
  title: string;
  createdAt: number;
  order: number; // 並び順
  isDone?: boolean; // サーバ is_done と同期
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

/* ========= ユーティリティ ========= */
const KEY = "checklist_v1";

// 同期関連（簡易版）：ユーザーと since をローカルに保存
const USER_ID = "demo"; // ← 本実装ではログインID等に差し替え
const SINCE_KEY = `support-ai:sync:since:${USER_ID}`;
const getSince = () => {
  const v = typeof window !== "undefined" ? localStorage.getItem(SINCE_KEY) : null;
  return v ? Number(v) : 0;
};
const setSince = (ms: number) => {
  if (typeof window !== "undefined") localStorage.setItem(SINCE_KEY, String(ms));
};
const resetSince = () => {
  if (typeof window !== "undefined") localStorage.setItem(SINCE_KEY, "0");
};

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
  const mm = m > 0 ? `${m}分` : (h > 0 && sec > 0 ? "0分" : "");
  const ss = `${sec}秒`;
  return `${hh}${mm}${ss}`;
}

function load(): Store {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
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
      version: 1,
    };
    return normalized?.version ? normalized : { sets: [], runs: [], version: 1 };
  } catch {
    return { sets: [], runs: [], version: 1 };
  }
}
function save(s: Store) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s));
}

const isMobileDevice = () =>
  typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const makeUpdatedBy = (deviceId: string) => `${isMobileDevice() ? "9" : "5"}|${deviceId}`;

/** 行動ログ push（固定FK直下、可変列は data）+ 任意メタを extraData に同梱可能 */
async function pushActionLog(params: {
  userId: string;
  deviceId: string;
  setId: string;
  actionId: string;
  startAt: number;
  endAt: number;
  extraData?: Record<string, any>;
}) {
  const { userId, deviceId, setId, actionId, startAt, endAt, extraData } = params;
  const updated_at = Date.now();
  const updated_by = makeUpdatedBy(deviceId);
  const duration_ms = Math.max(0, endAt - startAt);

  const payload = {
    user_id: userId,
    device_id: deviceId,
    changes: {
      checklist_sets: [],
      checklist_actions: [],
      checklist_action_logs: [
        {
          id: uid(),
          set_id: setId,
          action_id: actionId,
          updated_at,
          updated_by,
          deleted_at: null,
          data: {
            start_at_ms: startAt,
            end_at_ms: endAt,
            duration_ms,
            ...(extraData ?? {}),
          },
        },
      ],
    },
  };
  await pushBatch(payload);
}

/** ラン開始マーカ（run_start）を書き込む。duration=0 で記録 */
async function pushRunStartMarker(params: {
  userId: string;
  deviceId: string;
  setId: string;
  actionIdForMarker?: string | null; // 既存スキーマ都合で何かしら入れる（先頭アクション等）
  startedAt?: number;
}) {
  const { userId, deviceId, setId, actionIdForMarker, startedAt } = params;
  const t = startedAt ?? Date.now();
  const actionId = actionIdForMarker ?? "00000000-0000-0000-0000-000000000000"; // 念のため固定ダミー（実運用は先頭アクション推奨）
  await pushActionLog({
    userId,
    deviceId,
    setId,
    actionId,
    startAt: t,
    endAt: t,
    extraData: { kind: "run_start" },
  });
}

/* ========= 本体 ========= */
export default function Checklist() {
  const [store, setStore] = useState<Store>(() => load());
  const [msg, setMsg] = useState<string | null>(null);
  const pullingRef = useRef(false); // 多重PULL防止
  const storeRef = useRef(store); // 手動Pushで最新storeを参照
  useEffect(() => save(store), [store]);
  useEffect(() => {
    storeRef.current = store;
  }, [store]);

  // ====== ここから同期（Set + Action）差し込み ======
  const applySetDiffs = (rows: readonly ChecklistSetRow[] = []) => {
    if (rows.length === 0) return;
    setStore((prev) => {
      const idxMap = new Map(prev.sets.map((s, i) => [s.id, i] as const));
      let sets = prev.sets.slice();
      let current = prev.current;

      for (const row of rows) {
        if (row.deleted_at) {
          const i = idxMap.get(row.id);
          if (i != null) {
            const removedId = sets[i].id;
            sets.splice(i, 1);
            idxMap.delete(row.id);
            if (current?.setId === removedId) {
              const nextSet = sets[0];
              current = nextSet ? { setId: nextSet.id, index: 0, runId: uid() } : undefined;
            }
            for (let k = i; k < sets.length; k++) idxMap.set(sets[k].id, k);
          }
          continue;
        }

        const i = idxMap.get(row.id);
        if (i == null) {
          const created: ChecklistSet = {
            id: row.id,
            title: row.title,
            actions: [],
            createdAt: row.updated_at ?? now(),
          };
          sets = [...sets, created];
          idxMap.set(row.id, sets.length - 1);
        } else {
          const exists = sets[i];
          sets[i] = { ...exists, title: row.title };
        }
      }

      return { ...prev, sets, current };
    });
  };

  const applyActionDiffs = (rows: readonly ChecklistActionRow[] = []) => {
    if (rows.length === 0) return;
    setStore((prev) => {
      const bySet = new Map<string, ChecklistActionRow[]>();
      for (const r of rows) {
        if (!bySet.has(r.set_id)) bySet.set(r.set_id, []);
        bySet.get(r.set_id)!.push(r);
      }

      const nextSets = prev.sets.map((set) => {
        const patches = bySet.get(set.id);
        if (!patches || patches.length === 0) return set;

        const idx = new Map(set.actions.map((a, i) => [a.id, i] as const));
        let actions = set.actions.slice();

        for (const r of patches) {
          if (r.deleted_at) {
            const i = idx.get(r.id);
            if (i != null) {
              actions.splice(i, 1);
              idx.clear();
              actions.forEach((a, k) => idx.set(a.id, k));
            }
            continue;
          }
          const i = idx.get(r.id);
          if (i == null) {
            actions.push({
              id: r.id,
              title: r.title,
              createdAt: r.updated_at ?? now(),
              order: (r as any).order ?? actions.length,
              isDone: (r as any).is_done ?? false,
            });
            idx.set(r.id, actions.length - 1);
          } else {
            actions[i] = {
              ...actions[i],
              title: r.title,
              order: (r as any).order ?? actions[i].order,
              isDone: (r as any).is_done ?? actions[i].isDone ?? false,
            };
          }
        }

        actions = actions
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((a, i) => ({ ...a, order: i }));

        return { ...set, actions };
      });

      return { ...prev, sets: nextSets };
    });
  };

  // 受信（PULL）処理
  const doPullAll = async () => {
    if (pullingRef.current) return;
    pullingRef.current = true;
    try {
      const json = await pullBatch(USER_ID, getSince(), [
        "checklist_sets",
        "checklist_actions",
        // ログ参照は /nudge/checklist/logs 側で pull します
      ]);
      applySetDiffs(json.diffs.checklist_sets ?? []);
      applyActionDiffs(json.diffs.checklist_actions ?? []);
      setSince(json.server_time_ms);

      setStore((prev) => {
        if (!prev.current?.setId || !prev.sets.find((s) => s.id === prev.current!.setId)) {
          const first = prev.sets[0];
          if (first) {
            return { ...prev, current: { setId: first.id, index: 0, runId: uid() } };
          }
        }
        return prev;
      });

      setMsg("チェックリストを最新化しました。");
    } catch (e) {
      console.error("[sync] pull-batch failed:", e);
      setMsg("チェックリストの受信に失敗しました。");
    } finally {
      pullingRef.current = false;
    }
  };

  // 手動アップロード（PUSH）：ローカル全量をサーバに保存（ログは対象外）
  const manualPushAll = async () => {
    try {
      const snapshot = storeRef.current;
      const deviceId = getDeviceId();
      const updated_at = Date.now();
      const updated_by = makeUpdatedBy(deviceId);

      const setsSorted = snapshot.sets.slice().sort((a, b) => a.createdAt - b.createdAt);
      const setChanges = setsSorted.map((s, idx) => ({
        id: s.id,
        updated_at,
        updated_by,
        deleted_at: null,
        data: { title: s.title, order: idx },
      }));

      const actionChanges: any[] = [];
      for (const s of setsSorted) {
        const acts = s.actions.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        acts.forEach((a, i) => {
          actionChanges.push({
            id: a.id,
            set_id: s.id,
            updated_at,
            updated_by,
            deleted_at: null,
            data: { title: a.title, order: i, is_done: a.isDone ?? false },
          });
        });
      }

      const payload = {
        user_id: USER_ID,
        device_id: deviceId,
        changes: {
          checklist_sets: setChanges,
          checklist_actions: actionChanges,
          checklist_action_logs: [], // 全量PUSHでもログは送らない（確定時のみ送信）
        },
      };

      await pushBatch(payload);
      setMsg("この端末のチェックリストをクラウドに保存しました。");
    } catch (e) {
      console.warn("[manualPushAll] failed:", e);
      setMsg("手動アップロードに失敗しました。");
    }
  };

  // グローバル合図購読（PULL / RESET）
  useEffect(() => {
    const handler = (payload: any) => {
      if (!payload) return;
      if (payload.type === "GLOBAL_SYNC_PULL") {
        void doPullAll();
      } else if (payload.type === "GLOBAL_SYNC_RESET") {
        resetSince();
        void doPullAll();
        setMsg("同期をリセットし、サーバから再取得しました。");
      }
    };

    // 1) BroadcastChannel
    let bc: BroadcastChannel | undefined;
    try {
      if ("BroadcastChannel" in window) {
        bc = new BroadcastChannel("support-ai-sync");
        bc.onmessage = (e) => handler(e.data);
      }
    } catch {}

    // 2) 同タブ向け postMessage
    const onPostMessage = (e: MessageEvent) => handler(e.data);
    window.addEventListener("message", onPostMessage);

    // 3) 他タブ向け（storage 経由 pull 要求）
    const onStorage = (e: StorageEvent) => {
      if (e.key === "support-ai:sync:pull:req" && e.newValue) {
        try {
          handler(JSON.parse(e.newValue));
        } catch {}
      }
      if (e.key === "support-ai:sync:reset:req" && e.newValue) {
        try {
          handler(JSON.parse(e.newValue));
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      try {
        bc?.close();
      } catch {}
      window.removeEventListener("message", onPostMessage);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // グローバル“手動アップロード（PUSH）合図”の購読
  useEffect(() => {
    const unSub = subscribeGlobalPush((p) => {
      if (!p || p.userId !== USER_ID) return;
      void manualPushAll();
    });
    return () => {
      try {
        unSub();
      } catch {}
    };
  }, []);

  // 初回マウント時に一度だけ Pull
  useEffect(() => {
    void doPullAll();
  }, []);
  // ====== 同期差し込み ここまで ======

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

  // 再描画（経過表示用）
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
    (async () => {
      try {
        await upsertChecklistSet({
          userId: USER_ID,
          deviceId: getDeviceId(),
          id: newSet.id,
          title: newSet.title,
          order: store.sets.length,
        });
      } catch (e) {
        console.warn("[sync] upsert new set failed:", e);
      }
    })();
  };

  const renameSet = () => {
    if (!currentSet) return;
    const title = prompt("タイトル変更", currentSet.title);
    if (!title) return;
    setStore((s) => ({
      ...s,
      sets: s.sets.map((x) => (x.id === currentSet.id ? { ...x, title } : x)),
    }));
    (async () => {
      try {
        const order = store.sets.findIndex((s) => s.id === currentSet.id);
        await upsertChecklistSet({
          userId: USER_ID,
          deviceId: getDeviceId(),
          id: currentSet.id,
          title,
          order: Math.max(0, order),
        });
      } catch (e) {
        console.warn("[sync] rename set failed:", e);
      }
    })();
  };

  const deleteSet = () => {
    if (!currentSet) return;
    if (store.sets.length <= 1) return alert("少なくとも1つのセットが必要です。");
    if (!confirm(`「${currentSet.title}」を削除しますか？`)) return;

    const deletingId = currentSet.id;
    const nextSets = store.sets.filter((x) => x.id !== deletingId);
    const nextSet = nextSets[0];

    setStore((s) => ({
      ...s,
      sets: nextSets,
      current: nextSet ? { setId: nextSet.id, index: 0, runId: uid() } : undefined,
    }));

    (async () => {
      try {
        await upsertChecklistSet({
          userId: USER_ID,
          deviceId: getDeviceId(),
          id: deletingId,
          title: currentSet.title,
          order: Math.max(0, store.sets.findIndex((s) => s.id === deletingId)),
          deleted_at: Date.now(),
        });
      } catch (e) {
        console.warn("[sync] delete set failed:", e);
      }
    })();
  };

  /* ====== 行動編集（同期対応） ====== */
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

    (async () => {
      try {
        await upsertChecklistAction({
          userId: USER_ID,
          deviceId: getDeviceId(),
          id: newId,
          set_id: currentSet.id,
          title,
          order,
          is_done: false, // 新規は未完了
        } as any);
      } catch (e) {
        console.warn("[sync] addAction failed:", e);
      }
    })();
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

    (async () => {
      try {
        await upsertChecklistAction({
          userId: USER_ID,
          deviceId: getDeviceId(),
          id,
          set_id: currentSet!.id,
          title,
          order: a.order,
          is_done: a.isDone ?? false,
        } as any);
      } catch (e) {
        console.warn("[sync] renameAction failed:", e);
      }
    })();
  };

  const removeAction = (id: ID) => {
    if (!currentSet) return;
    if (!confirm("この行動を削除しますか？")) return;

    const target = currentSet.actions.find((x) => x.id === id);
    if (!target) return;

    setStore((s) => ({
      ...s,
      sets: s.sets.map((set) =>
        set.id !== currentSet.id
          ? set
          : {
              ...set,
              actions: set.actions
                .filter((x) => x.id !== id)
                .map((x, i) => ({ ...x, order: i })),
            }
      ),
      current:
        s.current?.setId === currentSet.id ? { ...s.current!, index: 0 } : s.current,
    }));

    (async () => {
      try {
        await deleteChecklistAction({
          userId: USER_ID,
          deviceId: getDeviceId(),
          id,
          set_id: currentSet.id,
          title: target.title,
          order: target.order,
          is_done: target.isDone ?? false,
        } as any);
      } catch (e) {
        console.warn("[sync] deleteAction failed:", e);
      }
    })();
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
          s.current?.setId === currentSet.id ? { ...s.current!, index: j } : s.current,
      }));

      (async () => {
        try {
          const deviceId = getDeviceId();
          for (let k = 0; k < swapped.length; k++) {
            const a = swapped[k];
            await upsertChecklistAction({
              userId: USER_ID,
              deviceId,
              id: a.id,
              set_id: currentSet.id,
              title: a.title,
              order: k,
              is_done: a.isDone ?? false,
            } as any);
          }
        } catch (e) {
          console.warn("[sync] reorder actions failed:", e);
        }
      })();
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

  // セット切替時：runId を新規にし、run_start マーカーを push
  const onChangeSet = (setId: ID) => {
    setStore((s) => ({
      ...s,
      current: { setId, index: 0, runId: uid() },
    }));
    (async () => {
      try {
        const deviceId = getDeviceId();
        const target = storeRef.current.sets.find((x) => x.id === setId);
        const firstActionId = target?.actions?.[0]?.id ?? null;
        await pushRunStartMarker({
          userId: USER_ID,
          deviceId,
          setId,
          actionIdForMarker: firstActionId ?? undefined,
          startedAt: Date.now(),
        });
      } catch (e) {
        console.warn("[sync] push run_start failed:", e);
      }
    })();
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

  // チェックリスト全体の開始（先延ばし開始・ランはローカル確保）
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

  // チェックリスト全体を終了（手動）
  const endChecklist = () => {
    const endedAt = now();
    const deviceId = getDeviceId();

    // setState 前に現在の状態を確保
    const curSetId = store.current?.setId;
    const curRunning = store.current?.running;
    const curPro = store.current?.procrastinating;

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
            next.actions[i] = { ...log, endAt: endedAt, durationMs: endedAt - log.startAt };
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

    // 実行中だった行動 or 「開始→何も始めず終了」の先延ばしを確定送信
    (async () => {
      try {
        if (curSetId && curRunning) {
          await pushActionLog({
            userId: USER_ID,
            deviceId,
            setId: curSetId,
            actionId: curRunning.actionId,
            startAt: curRunning.startAt,
            endAt: endedAt,
          });
        } else if (curSetId && curPro && curPro.fromActionId === null) {
          // 1番目の行動が始まらず終了した先延ばし
          const firstActionId =
            storeRef.current.sets.find((s) => s.id === curSetId)?.actions?.[0]?.id;
          if (firstActionId) {
            await pushActionLog({
              userId: USER_ID,
              deviceId,
              setId: curSetId,
              actionId: firstActionId,
              startAt: curPro.startAt,
              endAt: endedAt,
              extraData: { kind: "procrastination_before_first" },
            });
          }
        }
      } catch (e) {
        console.warn("[sync] endChecklist pushActionLog failed:", e);
      }
    })();
  };

  // 行動を開始（is_done=false を同期）＋「開始→1番目まで」の先延ばしを確定保存
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

      // ★ ここで「開始→1番目まで」の先延ばしを push（fromActionId === null）
      (async () => {
        try {
          if (p.fromActionId === null && currentSet) {
            await pushActionLog({
              userId: USER_ID,
              deviceId: getDeviceId(),
              setId: currentSet.id,
              actionId: a.id, // 1番目として開始した行動に紐づけ
              startAt: p.startAt,
              endAt: endedAt,
              extraData: { kind: "procrastination_before_first" },
            });
          }
        } catch (e) {
          console.warn("[sync] push procrastination_before_first failed:", e);
        }
      })();
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
          : { ...set, actions: set.actions.map((x) => (x.id === a.id ? { ...x, isDone: false } : x)) }
      ),
      current: { ...s.current!, running: { actionId: a.id, startAt: t } },
      runs: s.runs.map((r) =>
        r.id !== s.current!.runId
          ? r
          : { ...r, actions: [...r.actions, { actionId: a.id, startAt: t }] }
      ),
    }));

    // サーバに is_done=false を同期
    (async () => {
      try {
        await upsertChecklistAction({
          userId: USER_ID,
          deviceId: getDeviceId(),
          id: a.id,
          set_id: currentSet!.id,
          title: a.title,
          order: a.order,
          is_done: false,
        } as any);
      } catch (e) {
        console.warn("[sync] startAction is_done=false failed:", e);
      }
    })();
  };

  // 行動を「先延ばしへ」
  const procrastinateNow = () => {
    const endedAt = now();
    const deviceId = getDeviceId();

    // setState 前に参照を確保
    const curSetId = store.current?.setId;
    const curRunning = store.current?.running;

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

    // 実行中だった行動のログを確定送信
    (async () => {
      try {
        if (curSetId && curRunning) {
          await pushActionLog({
            userId: USER_ID,
            deviceId,
            setId: curSetId,
            actionId: curRunning.actionId,
            startAt: curRunning.startAt,
            endAt: endedAt,
          });
        }
      } catch (e) {
        console.warn("[sync] procrastinate pushActionLog failed:", e);
      }
    })();
  };

  // 終了：最後の行動ならラン終了／それ以外は次の行動までの先延ばしを開始
  const endActionInternal = (actionId: ID) => {
    const endedAt = now();
    const deviceId = getDeviceId();

    // setState 前に現在の running/startAt と setId を確保
    const curSetId = store.current?.setId;
    const curRunning = store.current?.running;

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
              actions: set.actions.map((a) => (a.id === actionId ? { ...a, isDone: true } : a)),
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

      const nextIndex = Math.min((cur.index ?? 0) + 1, Math.max(0, (total ?? 1) - 1));
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

    // ログ確定の PUSH（startAt は curRunning から取得）＋ is_done=true をサーバ反映
    (async () => {
      try {
        if (curSetId && curRunning && curRunning.actionId === actionId) {
          await pushActionLog({
            userId: USER_ID,
            deviceId,
            setId: curSetId,
            actionId,
            startAt: curRunning.startAt,
            endAt: endedAt,
          });
        }
      } catch (e) {
        console.warn("[sync] endAction pushActionLog failed:", e);
      }
      // is_done=true を同期
      try {
        const a = currentSet?.actions.find((x) => x.id === actionId);
        if (a && currentSet) {
          await upsertChecklistAction({
            userId: USER_ID,
            deviceId,
            id: a.id,
            set_id: currentSet.id,
            title: a.title,
            order: a.order,
            is_done: true,
          } as any);
        }
      } catch (e) {
        console.warn("[sync] endAction is_done=true failed:", e);
      }
    })();
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
          <button onClick={addSet} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            新規セット
          </button>
          <button onClick={renameSet} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            タイトル変更
          </button>
          <button onClick={deleteSet} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            セット削除
          </button>
        </div>
      </div>

      {/* 同期デバッグ操作 */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={doPullAll}
          className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
          title="サーバ→この端末に反映"
        >
          PULL
        </button>
        <button
          onClick={() => {
            resetSince();
            void doPullAll();
          }}
          className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
          title="since を 0 に戻して全期間再取得"
        >
          RESET
        </button>
        <button
          onClick={manualPushAll}
          className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
          title="この端末のセット／行動をサーバに保存（ログは除外）"
        >
          PUSH
        </button>
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
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
                  <span className="ml-2 text-xs text-green-600 align-middle">（完了）</span>
                ) : null}
              </h2>
              <div className="flex gap-2">
                <button onClick={() => moveAction(action.id, -1)} className="rounded-lg border px-2 py-1 text-sm">
                  ↑
                </button>
                <button onClick={() => moveAction(action.id, +1)} className="rounded-lg border px-2 py-1 text-sm">
                  ↓
                </button>
                <button onClick={() => renameAction(action.id)} className="rounded-lg border px-2 py-1 text-sm">
                  名称変更
                </button>
                <button onClick={() => removeAction(action.id)} className="rounded-lg border px-2 py-1 text-sm">
                  削除
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {!running || running.actionId !== action.id ? (
                <button onClick={() => startAction(action)} className="rounded-xl bg-black text-white px-5 py-3">
                  開始
                </button>
              ) : (
                <>
                  <button onClick={endAction} className="rounded-xl border px-5 py-3 hover:bg-gray-50">
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
                <span className="text-sm text-gray-700">進行中：{fmtDuration(runningElapsedMs)}</span>
              )}
              {!running && procrastinating && procrastinating.fromActionId !== null && (
                <span className="text-sm text-red-600">先延ばし中：{fmtDuration(procrastElapsedMs)}</span>
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-500">行動がありません。まずは「行動を追加」を押してください。</div>
        )}
      </section>

      {/* 行動一覧（編集用） */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">行動一覧</h3>
          <button onClick={addAction} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            行動を追加
          </button>
        </div>
        {actionsSorted.length === 0 ? (
          <p className="text-sm text-gray-500">まだ行動がありません。</p>
        ) : (
          <ol className="space-y-1 list-decimal pl-5">
            {actionsSorted.map((a, i) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                <button
                  onClick={() => go(i)}
                  className="text-left underline-offset-2 hover:underline min-w-0 break-words"
                >
                  {a.title}
                  {a.isDone ? "（完了）" : ""}
                </button>
                <div className="flex gap-1">
                  <button onClick={() => moveAction(a.id, -1)} className="rounded-lg border px-2 py-1 text-xs">
                    ↑
                  </button>
                  <button onClick={() => moveAction(a.id, +1)} className="rounded-lg border px-2 py-1 text-xs">
                    ↓
                  </button>
                  <button onClick={() => renameAction(a.id)} className="rounded-lg border px-2 py-1 text-xs">
                    名
                  </button>
                  <button onClick={() => removeAction(a.id)} className="rounded-lg border px-2 py-1 text-xs">
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
