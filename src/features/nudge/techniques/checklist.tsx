// src/features/nudge/techniques/checklist.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

// ↓ 同期ユーティリティ（Set + Action を使う）
import {
  startSmartSync,
  pullBatch,
  upsertChecklistSet,
  upsertChecklistAction,
  deleteChecklistAction,
  forceSyncAsMaster,
  type PullResponse,
  type ChecklistSetRow,
  type ChecklistActionRow,
} from "@/lib/sync";
import { getDeviceId } from "@/lib/device";

/* ========= 型 ========= */
type ID = string;

type Action = {
  id: ID;
  title: string;
  createdAt: number;
  order: number; // 並び順
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
  durationMs?: number; // end時に確定
};

type ProcrastinationLog = {
  fromActionId: ID | null; // 直前に終了した行動ID（最初の待機は null）
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

// ★ 同期関連（簡易版）：ユーザーと since をローカルに保存
const USER_ID = "demo"; // ← 本実装ではログインID等に差し替え
const SINCE_KEY = `support-ai:sync:since:${USER_ID}`;
const getSince = () => {
  const v = typeof window !== "undefined" ? localStorage.getItem(SINCE_KEY) : null;
  return v ? Number(v) : 0;
};
const setSince = (ms: number) => {
  if (typeof window !== "undefined") localStorage.setItem(SINCE_KEY, String(ms));
};

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
      // 初期セット（ナイトルーティン例）
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
  const [syncing, setSyncing] = useState(false); // 画面内ミニ同期ボタン用メッセージ
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => save(store), [store]);

  // ====== ここから同期（Set + Action）差し込み ======
  // Set の差分をローカルへマージ
  const applySetDiffs = (rows: ChecklistSetRow[]) => {
    if (!rows || rows.length === 0) return;
    setStore((prev) => {
      const idxMap = new Map(prev.sets.map((s, i) => [s.id, i]));
      let sets = prev.sets.slice();
      let current = prev.current;

      for (const row of rows) {
        if (row.deleted_at) {
          const i = idxMap.get(row.id);
          if (i !== undefined) {
            const removedId = sets[i].id;
            sets.splice(i, 1);
            idxMap.delete(row.id);
            // current の整合
            if (current?.setId === removedId) {
              const nextSet = sets[0];
              current = nextSet ? { setId: nextSet.id, index: 0, runId: uid() } : undefined;
            }
            // インデックス再構築
            for (let k = i; k < sets.length; k++) idxMap.set(sets[k].id, k);
          }
          continue;
        }

        const i = idxMap.get(row.id);
        if (i === undefined) {
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

  // Action の差分をローカルへマージ
  const applyActionDiffs = (rows: ChecklistActionRow[]) => {
    if (!rows || rows.length === 0) return;
    setStore((prev) => {
      // set_id ごとにまとめる
      const bySet = new Map<string, ChecklistActionRow[]>();
      for (const r of rows) {
        if (!bySet.has(r.set_id)) bySet.set(r.set_id, []);
        bySet.get(r.set_id)!.push(r);
      }

      const nextSets = prev.sets.map((set) => {
        const patches = bySet.get(set.id);
        if (!patches || patches.length === 0) return set;

        // 既存 actions のインデックス
        const idx = new Map(set.actions.map((a, i) => [a.id, i]));
        let actions = set.actions.slice();

        for (const r of patches) {
          if (r.deleted_at) {
            const i = idx.get(r.id);
            if (i !== undefined) {
              actions.splice(i, 1);
              idx.clear();
              actions.forEach((a, k) => idx.set(a.id, k));
            }
            continue;
          }
          const i = idx.get(r.id);
          if (i === undefined) {
            actions.push({
              id: r.id,
              title: r.title,
              createdAt: r.updated_at ?? now(),
              order: r.order ?? actions.length,
            });
            idx.set(r.id, actions.length - 1);
          } else {
            actions[i] = {
              ...actions[i],
              title: r.title,
              order: r.order ?? actions[i].order,
            };
          }
        }

        // 並び順を正規化
        actions = actions
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((a, i) => ({ ...a, order: i }));

        return { ...set, actions };
      });

      return { ...prev, sets: nextSets };
    });
  };

  // 初回 pull（安全のため since=local）＆ スマート同期（SSE→ポーリング）
  useEffect(() => {
    const abort = new AbortController();
    const deviceId = getDeviceId();

    (async () => {
      try {
        const json = await pullBatch(USER_ID, getSince(), ["checklist_sets", "checklist_actions"]);
        applySetDiffs(json.diffs.checklist_sets);
        applyActionDiffs(json.diffs.checklist_actions);
        setSince(json.server_time_ms);
      } catch (e) {
        console.error("[sync] initial pull failed:", e);
      }
    })();

    const ctl = startSmartSync({
      userId: USER_ID,
      deviceId,
      getSince,
      setSince,
      applyDiffs: (diffs: PullResponse["diffs"]) => {
        applySetDiffs(diffs.checklist_sets);
        applyActionDiffs(diffs.checklist_actions);
      },
      fallbackPolling: true,
      pollingIntervalMs: 30000,
      abortSignal: abort.signal,
    });

    return () => {
      abort.abort();
      ctl.stop();
    };
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
    // ローカル即時
    setStore((s) => ({
      ...s,
      sets: [...s.sets, newSet],
      current: { setId: newSet.id, index: 0, runId: uid() },
    }));
    // サーバ upsert
    (async () => {
      try {
        await upsertChecklistSet({
          userId: USER_ID,
          deviceId: getDeviceId(),
          id: newSet.id,
          title: newSet.title,
          order: store.sets.length, // 末尾
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
    // ローカル即時
    setStore((s) => ({
      ...s,
      sets: s.sets.map((x) => (x.id === currentSet.id ? { ...x, title } : x)),
    }));
    // サーバ upsert
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

    // ローカル即時
    setStore((s) => ({
      ...s,
      sets: nextSets,
      current: nextSet ? { setId: nextSet.id, index: 0, runId: uid() } : undefined,
    }));

    // サーバ（ソフトデリート）
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

    // ローカル
    setStore((s) => ({
      ...s,
      sets: s.sets.map((set) =>
        set.id !== currentSet.id
          ? set
          : {
              ...set,
              actions: [
                ...set.actions,
                { id: newId, title, createdAt: now(), order },
              ],
            }
      ),
    }));

    // サーバ
    (async () => {
      try {
        await upsertChecklistAction({
          userId: USER_ID,
          deviceId: getDeviceId(),
          id: newId,
          set_id: currentSet.id,
          title,
          order,
        });
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

    // ローカル
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

    // サーバ
    (async () => {
      try {
        await upsertChecklistAction({
          userId: USER_ID,
          deviceId: getDeviceId(),
          id,
          set_id: currentSet!.id,
          title,
          order: a.order,
        });
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

    // ローカル
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

    // サーバ（ソフトデリート）
    (async () => {
      try {
        await deleteChecklistAction({
          userId: USER_ID,
          deviceId: getDeviceId(),
          id,
          set_id: currentSet.id,
          title: target.title,
          order: target.order,
        });
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

      // ローカル
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

      // サーバ（新しい order を全件 upsert）
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
            });
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
        ? { ...s.current, index: Math.max(0, Math.min(i, Math.max(0, (currentSet?.actions.length ?? 1) - 1))) }
        : s.current,
    }));
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

  // チェックリスト全体を終了（手動）
  const endChecklist = () => {
    const endedAt = now();
    setStore((prev) => {
      if (!prev.current) return prev;
      const cur = prev.current;
      const runId = cur.runId;

      const runs = prev.runs.map((r) => {
        if (r.id !== runId) return r;
        const next = { ...r };

        // 実行中の行動があれば終了だけ確定
        if (cur.running) {
          const i = next.actions.findIndex(
            (l) => l.actionId === cur.running!.actionId && !l.endAt
          );
          if (i >= 0) {
            const log = next.actions[i];
            next.actions[i] = { ...log, endAt: endedAt, durationMs: endedAt - log.startAt };
          }
        }
        // 先延ばしが開いていれば確定
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

  const startAction = (a: Action) => {
    // 先延ばし中なら確定
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

    // 他の行動が走っていれば終了
    if (running && running.actionId !== a.id) endActionInternal(running.actionId);

    ensureRun();
    const t = now();
    setStore((s) => ({
      ...s,
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

  // ★終了：最後の行動ならラン終了／それ以外は次の行動までの先延ばしを開始
  const endActionInternal = (actionId: ID) => {
    const endedAt = now();
    setStore((prev) => {
      if (!prev.current) return prev;

      const cur = prev.current;
      const runId = cur.runId;

      // セット内の最後の行動かどうか
      const setForCalc = prev.sets.find((s) => s.id === cur.setId);
      const total = setForCalc ? setForCalc.actions.length : 0;
      const isLast = (cur.index ?? 0) >= Math.max(0, total - 1);

      const runs = prev.runs.map((run) => {
        if (run.id !== runId) return run;
        const next = { ...run };

        // 実行中の行動ログを終了
        const logs = next.actions.slice();
        const i = logs.findIndex((l) => l.actionId === actionId && !l.endAt);
        if (i >= 0) {
          const log = logs[i];
          logs[i] = { ...log, endAt: endedAt, durationMs: endedAt - log.startAt };
        }
        next.actions = logs;

        // 最後の行動ならこのランを終了
        if (isLast) {
          next.endedAt = endedAt;
        }

        return next;
      });

      if (isLast) {
        // ラン終了：先延ばし開始せず、状態をクリア
        return {
          ...prev,
          runs,
          current: { ...cur, running: undefined, procrastinating: undefined },
        };
      }

      // まだ続きがある：ページ送り＋次の行動まで先延ばし開始
      const nextIndex = Math.min((cur.index ?? 0) + 1, Math.max(0, (total ?? 1) - 1));
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
            onChange={(e) =>
              setStore((s) => ({
                ...s,
                current: { setId: e.target.value as ID, index: 0, runId: uid() },
              }))
            }
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

          {/* ミニ同期（この端末を正に）— チェックリストだけ即反映したい時のショートカット */}
          <button
            onClick={async () => {
              try {
                setMsg(null);
                setSyncing(true);
                await forceSyncAsMaster({
                  userId: USER_ID,
                  deviceId: getDeviceId(),
                  getSince,
                  setSince,
                  applyDiffs: (diffs) => {
                    applySetDiffs(diffs.checklist_sets);
                    applyActionDiffs(diffs.checklist_actions);
                  },
                });
                setMsg("この端末の内容でチェックリストを同期しました。");
              } catch (e: any) {
                setMsg(`同期に失敗：${e?.message ?? e}`);
              } finally {
                setSyncing(false);
              }
            }}
            disabled={syncing}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            title="この端末の内容を正としてチェックリストを即時同期します（全機能の一括同期はホーム画面のボタンから）"
          >
            {syncing ? "同期中…" : "🔄 この端末で同期"}
          </button>
        </div>
      </div>

      {msg && <p className="text-xs text-gray-600">{msg}</p>}

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

        {(!running && procrastinating && procrastinating.fromActionId === null) && (
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
              <h2 className="text-xl font-semibold break-words">{action.title}</h2>
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
                <button
                  onClick={() => startAction(action)}
                  className="rounded-xl bg-black text-white px-5 py-3"
                >
                  開始
                </button>
              ) : (
                <>
                  <button onClick={endAction} className="rounded-xl border px-5 py-3 hover:bg-gray-50">
                    終了
                  </button>
                  {/* 行動中だけ出現：先延ばしへ戻る */}
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
