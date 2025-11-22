// src/features/nudge/techniques/checklist-logs.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

/* ===== チェックリスト本体と同じ Store 型 ===== */
type Action = {
  id: ID;
  title: string;
  createdAt: number;
  order: number;
  isDone?: boolean;
  memo?: string;
  /** 目標時間（秒）。UI では mm:ss で編集。 */
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
  durationMs?: number;
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
    index: number;
    running?: { actionId: ID; startAt: number };
    procrastinating?: { fromActionId: ID | null; startAt: number };
    runId: ID;
  };
  version: 1;
};

/* ===== 手動同期用 定数 ===== */
const LOCAL_KEY = "checklist_v1";
/** checklist.tsx と同じ互換モード */
const DOC_KEYS = ["checklist_v1", "nudge_checklist_v1"] as const;

const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

/* ===== JST 日付ユーティリティ ===== */
function dateToYmdJst(d: Date): string {
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = p.find((x) => x.type === "year")!.value;
  const m = p.find((x) => x.type === "month")!.value;
  const da = p.find((x) => x.type === "day")!.value;
  return `${y}-${m}-${da}`;
}

function dayRangeJst(yyyyMmDd: string) {
  const start = Date.parse(`${yyyyMmDd}T00:00:00.000+09:00`);
  const end = Date.parse(`${yyyyMmDd}T23:59:59.999+09:00`);
  return { start, end };
}

const fmtTime = (t?: number | null) =>
  t == null
    ? "…"
    : new Date(t).toLocaleTimeString("ja-JP", { hour12: false });

/**
 * ○時間○分○秒 表記
 * - 負の値は 0 とみなす
 * - 必ず 3単位すべて表示（0時間0分30秒 など）
 */
const fmtDur = (ms?: number | null) => {
  if (ms == null) return "—";
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}時間${m}分${s}秒`;
};

/** targetSec(秒) を "mm:ss" 表記へ */
const fmtTargetMmSs = (targetSec?: number) => {
  if (targetSec == null) return "—";
  const t = Math.max(0, Math.round(targetSec));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

/* ===== localStorage 読み込み/保存 ===== */
function loadLocal(): Store {
  try {
    if (typeof window === "undefined") {
      return { sets: [], runs: [], version: 1 };
    }
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { sets: [], runs: [], version: 1 };
    const parsed = JSON.parse(raw) as Store;
    return {
      sets: (parsed.sets ?? []).map((s) => ({
        ...s,
        actions: (s.actions ?? []).map((a) => ({
          ...a,
          isDone: a.isDone ?? false,
          memo: a.memo ?? "",
          targetSec:
            typeof a.targetSec === "number" && !Number.isNaN(a.targetSec)
              ? a.targetSec
              : undefined,
        })),
      })),
      runs: (parsed.runs ?? []).map((r) => ({
        ...r,
        actions: (r.actions ?? []).map((al) => ({
          ...al,
          success:
            typeof al.success === "boolean" ? al.success : undefined,
        })),
      })),
      current: parsed.current,
      version: 1,
    };
  } catch {
    return { sets: [], runs: [], version: 1 };
  }
}

function saveLocal(store: Store) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
    }
  } catch {
    // noop
  }
}

/* ===== 表示用の型 ===== */
type Row = {
  rowId: string;
  runId: ID;
  actionIndex: number;
  procrastIndex: number | null;
  actionTitle: string;
  targetSec?: number;
  success?: boolean;
  procrast: { startAt?: number; endAt?: number; durationMs?: number } | null;
  action: { startAt: number; endAt?: number; durationMs?: number };
};

type RunView = {
  runId: ID;
  runKey: string;
  setId: ID;
  setTitle: string;
  startedAt: number | null;
  rows: Row[];
  sumAction: number;
  sumPro: number;
  runAttempts: number; // このランで成功判定した行動数（目標時間あり）
  runSuccesses: number; // このランで成功した件数
};

type ActionSuccessSummary = {
  setId: ID;
  setTitle: string;
  actionId: ID;
  actionTitle: string;
  targetSec?: number;
  successCount: number;
  totalCount: number;
  order: number;
};

export default function ChecklistLogs() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);
  const [msg, setMsg] = useState<string | null>(null);
  const [date, setDate] = useState<string>(() => dateToYmdJst(new Date()));
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  // store → localStorage
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // ==== 共通: サーバからの PULL / サーバへの PUSH ==== //
  const pullFromServer = async () => {
    for (const key of DOC_KEYS) {
      try {
        const remote = await loadUserDoc<Store>(key);
        if (remote && typeof remote === "object") {
          const normalized: Store = {
            ...remote,
            sets: (remote.sets ?? []).map((s) => ({
              ...s,
              actions: (s.actions ?? []).map((a) => ({
                ...a,
                isDone: a.isDone ?? false,
                memo: a.memo ?? "",
                targetSec:
                  typeof a.targetSec === "number" && !Number.isNaN(a.targetSec)
                    ? a.targetSec
                    : undefined,
              })),
            })),
            runs: (remote.runs ?? []).map((r) => ({
              ...r,
              actions: (r.actions ?? []).map((al) => ({
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
        console.warn(`[checklist-logs] PULL failed for docKey=${key}:`, e);
      }
    }
  };

  const pushToServer = async () => {
    const snapshot = storeRef.current;
    for (const key of DOC_KEYS) {
      try {
        await saveUserDoc<Store>(key, snapshot);
      } catch (e) {
        console.warn(`[checklist-logs] PUSH failed for docKey=${key}:`, e);
      }
    }
  };

  // 手動同期購読（ホーム📥/☁ との連携）
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = () => {
      void pullFromServer();
    };

    const doPush = () => {
      void pushToServer();
    };

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
            // since を使わないので noop
          } else if (
            t === LOCAL_APPLIED_TYPE &&
            msg.docKey &&
            DOC_KEYS.includes(msg.docKey)
          ) {
            setStore(loadLocal());
          }
        };
      }
    } catch {
      // noop
    }

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
        // noop（直後の PULL に期待）
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
  }, []);

  /* ===== 画面用の組み立て ===== */
  const setMap = useMemo(
    () => new Map(store.sets.map((s) => [s.id, s] as const)),
    [store.sets]
  );
  const day = useMemo(() => dayRangeJst(date), [date]);

  const views: RunView[] = useMemo(() => {
    const { start, end } = day;
    const runsForDay = store.runs.filter((r) => {
      const t = r.startedAt ?? r.actions[0]?.startAt ?? null;
      if (t == null) return false;
      return t >= start && t <= end;
    });

    const vs: RunView[] = [];

    for (const run of runsForDay) {
      const set = setMap.get(run.setId);
      const actions = run.actions.slice();
      const procs = run.procrastinations
        .slice()
        .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0));
      const usedPro = new Set<number>();

      const rows: Row[] = [];
      let runAttempts = 0;
      let runSuccesses = 0;

      for (let i = 0; i < actions.length; i++) {
        const al = actions[i];
        const prevActionId: ID | null =
          i === 0 ? null : actions[i - 1].actionId;

        let procrastIndex: number | null = null;
        for (let j = 0; j < procs.length; j++) {
          if (usedPro.has(j)) continue;
          const p = procs[j];
          if (p.fromActionId === prevActionId) {
            procrastIndex = j;
            usedPro.add(j);
            break;
          }
        }

        const procrast =
          procrastIndex == null
            ? null
            : {
                startAt: procs[procrastIndex].startAt,
                endAt: procs[procrastIndex].endAt,
                durationMs: procs[procrastIndex].durationMs,
              };

        const actionDur =
          al.durationMs ??
          (al.endAt != null ? Math.max(0, al.endAt - al.startAt) : undefined);

        const actionEntity = set?.actions.find(
          (a) => a.id === al.actionId
        );
        const title = actionEntity?.title ?? "(不明な行動)";
        const targetSec = actionEntity?.targetSec;

        // success フラグ：ログにあればそれを優先、なければ duration + target から再計算
        let success: boolean | undefined = al.success;
        if (success == null && targetSec != null && actionDur != null) {
          success = actionDur <= targetSec * 1000;
        }

        if (targetSec != null && actionDur != null) {
          runAttempts += 1;
          if (success) runSuccesses += 1;
        }

        rows.push({
          rowId: `${run.id}:${i}`,
          runId: run.id,
          actionIndex: i,
          procrastIndex,
          actionTitle: title,
          targetSec,
          success,
          procrast,
          action: {
            startAt: al.startAt,
            endAt: al.endAt,
            durationMs: actionDur,
          },
        });
      }

      const sumAction = rows.reduce(
        (s, r) => s + (r.action.durationMs ?? 0),
        0
      );
      const sumPro = run.procrastinations.reduce((s, p) => {
        const d =
          p.durationMs ??
          (p.endAt != null && p.startAt != null
            ? Math.max(0, p.endAt - p.startAt)
            : 0);
        return s + d;
      }, 0);

      const startedAt =
        run.startedAt ??
        run.actions[0]?.startAt ??
        run.procrastinations[0]?.startAt ??
        null;

      vs.push({
        runId: run.id,
        runKey: run.id,
        setId: run.setId,
        setTitle: set?.title ?? "(不明なセット)",
        startedAt,
        rows,
        sumAction,
        sumPro,
        runAttempts,
        runSuccesses,
      });
    }

    vs.sort(
      (a, b) =>
        (a.startedAt ?? 0) - (b.startedAt ?? 0) ||
        a.setTitle.localeCompare(b.setTitle, "ja")
    );
    return order === "asc" ? vs : vs.slice().reverse();
  }, [store.runs, setMap, day, order]);

  /* ===== 全期間の成功率集計（チェックリスト全体） ===== */
  const globalSuccess: ActionSuccessSummary[] = useMemo(() => {
    const stats = new Map<string, ActionSuccessSummary>();
    const setById = new Map(store.sets.map((s) => [s.id, s] as const));

    for (const run of store.runs) {
      const set = setById.get(run.setId);
      if (!set) continue;

      for (const al of run.actions) {
        const action = set.actions.find((a) => a.id === al.actionId);
        if (!action || action.targetSec == null) continue;

        const durationMs =
          al.durationMs ??
          (al.endAt != null ? Math.max(0, al.endAt - al.startAt) : undefined);
        if (durationMs == null) continue;

        let success = al.success;
        if (success == null) {
          success = durationMs <= action.targetSec * 1000;
        }

        const key = `${set.id}:${action.id}`;
        let s = stats.get(key);
        if (!s) {
          s = {
            setId: set.id,
            setTitle: set.title,
            actionId: action.id,
            actionTitle: action.title,
            targetSec: action.targetSec,
            successCount: 0,
            totalCount: 0,
            order: action.order ?? 0,
          };
          stats.set(key, s);
        }
        s.totalCount += 1;
        if (success) s.successCount += 1;
      }
    }

    return Array.from(stats.values()).sort((a, b) => {
      if (a.setTitle !== b.setTitle) {
        return a.setTitle.localeCompare(b.setTitle, "ja");
      }
      return a.order - b.order;
    });
  }, [store.sets, store.runs]);

  /* ===== 削除 & 成功トグル ハンドラ ===== */
  const handleDeleteRow = (row: Row) => {
    if (!confirm("この行（合流した先延ばしを含む）を削除しますか？")) return;

    setStore((prev) => {
      const runs = prev.runs.slice();
      const idx = runs.findIndex((r) => r.id === row.runId);
      if (idx < 0) return prev;

      const run = runs[idx];
      const actions = run.actions.slice();
      const procs = run.procrastinations.slice();

      if (row.actionIndex >= 0 && row.actionIndex < actions.length) {
        actions.splice(row.actionIndex, 1);
      }
      if (
        row.procrastIndex != null &&
        row.procrastIndex >= 0 &&
        row.procrastIndex < procs.length
      ) {
        procs.splice(row.procrastIndex, 1);
      }

      if (actions.length === 0 && procs.length === 0) {
        runs.splice(idx, 1);
      } else {
        runs[idx] = { ...run, actions, procrastinations: procs };
      }

      return { ...prev, runs };
    });

    setMsg("行を削除しました。");
  };

  const handleDeleteRun = (rv: RunView) => {
    if (!confirm("このランの記録をすべて削除しますか？（取り消せません）"))
      return;

    setStore((prev) => ({
      ...prev,
      runs: prev.runs.filter((r) => r.id !== rv.runId),
    }));
    setMsg("ランの記録を削除しました。");
  };

  const handleToggleSuccess = (row: Row) => {
    setStore((prev) => {
      const runs = prev.runs.map((run) => {
        if (run.id !== row.runId) return run;
        const actions = run.actions.slice();
        const log = actions[row.actionIndex];
        if (!log) return run;

        const currentSuccess =
          typeof log.success === "boolean"
            ? log.success
            : typeof row.success === "boolean"
            ? row.success
            : undefined;

        const nextSuccess =
          currentSuccess === true ? false : true; // undefined も true にする

        actions[row.actionIndex] = { ...log, success: nextSuccess };
        return { ...run, actions };
      });
      return { ...prev, runs };
    });
    setMsg("結果を更新しました。（○/× は手動で上書きできます）");
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">記録参照</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOrder((o) => (o === "asc" ? "desc" : "asc"))}
              className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
              title="チェックリスト使用順の並び替え"
            >
              並び: {order === "asc" ? "昇順（古→新）" : "降順（新→古）"}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <label className="text-sm text-gray-600">日付:</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border px-3 py-2"
          />
          {msg && <span className="text-xs text-gray-500">{msg}</span>}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          指定日のJSTに開始したチェックリスト実行（ラン）を表示します。下ほど新しい使用になります（トグルで反転可）。
        </p>
      </section>

      {views.length === 0 ? (
        <p className="text-sm text-gray-500">指定日の記録はありません。</p>
      ) : (
        views.map((v) => {
          const rate =
            v.runAttempts > 0
              ? Math.round((v.runSuccesses / v.runAttempts) * 100)
              : null;

          return (
            <section
              key={v.runKey}
              className="rounded-2xl border p-4 shadow-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold">{v.setTitle}</h3>
                    {v.startedAt != null && (
                      <span className="text-xs text-gray-500">
                        開始: {fmtTime(v.startedAt)}
                      </span>
                    )}
                  </div>
                  {rate != null && (
                    <span className="text-xs text-gray-600">
                      このランの成功率: {v.runSuccesses}/{v.runAttempts}（
                      {rate}%）
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteRun(v)}
                  className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
                  title="このランに含まれる記録をすべて削除します"
                >
                  ランを削除
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[1040px] w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">行動</th>
                      <th className="py-2 pr-3">先延ばし開始</th>
                      <th className="py-2 pr-3">先延ばし終了</th>
                      <th className="py-2 pr-3">先延ばし時間</th>
                      <th className="py-2 pr-3">開始</th>
                      <th className="py-2 pr-3">終了</th>
                      <th className="py-2 pr-3">所要時間</th>
                      <th className="py-2 pr-3">結果</th>
                      <th className="py-2 pr-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.rows.map((r, i) => {
                      const mark =
                        r.success == null
                          ? "—"
                          : r.success
                          ? "○"
                          : "×";
                      return (
                        <tr key={r.rowId} className="border-t">
                          <td className="py-2 pr-3 tabular-nums">{i + 1}</td>
                          <td className="py-2 pr-3">{r.actionTitle}</td>
                          <td className="py-2 pr-3 tabular-nums">
                            {fmtTime(r.procrast?.startAt)}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {fmtTime(r.procrast?.endAt)}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {fmtDur(r.procrast?.durationMs)}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {fmtTime(r.action.startAt)}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {fmtTime(r.action.endAt)}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {fmtDur(r.action.durationMs)}
                          </td>
                          <td className="py-2 pr-3">
                            <button
                              onClick={() => handleToggleSuccess(r)}
                              className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50 tabular-nums"
                              title="○/× を手動で切り替え（成功判定の最終調整）"
                            >
                              {mark}
                            </button>
                          </td>
                          <td className="py-2 pr-3">
                            <button
                              onClick={() => handleDeleteRow(r)}
                              className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                              title="この行（合流した先延ばしを含む）を削除"
                            >
                              行を削除
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t font-medium">
                      <td className="py-2 pr-3" colSpan={4}>
                        合計
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {fmtDur(v.sumPro)}
                      </td>
                      <td className="py-2 pr-3" colSpan={2}></td>
                      <td className="py-2 pr-3 tabular-nums">
                        {fmtDur(v.sumAction)}
                      </td>
                      <td className="py-2 pr-3" colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      {/* 全体の成功率一覧 */}
      {globalSuccess.length > 0 && (
        <section className="rounded-2xl border p-4 shadow-sm">
          <h3 className="font-semibold mb-2">
            チェックリスト全体の各行動の成功率（全ラン通算）
          </h3>
          <p className="text-xs text-gray-500 mb-2">
            目標時間が設定されている行動のみカウントしています。
          </p>

          <div className="overflow-x-auto">
            <table className="min-w-[880px] w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2 pr-3">チェックリスト</th>
                  <th className="py-2 pr-3">行動</th>
                  <th className="py-2 pr-3">目標時間</th>
                  <th className="py-2 pr-3">成功回数</th>
                  <th className="py-2 pr-3">試行回数</th>
                  <th className="py-2 pr-3">成功率</th>
                </tr>
              </thead>
              <tbody>
                {globalSuccess.map((s) => {
                  const rate =
                    s.totalCount > 0
                      ? Math.round(
                          (s.successCount / s.totalCount) * 100
                        )
                      : 0;
                  return (
                    <tr key={`${s.setId}:${s.actionId}`} className="border-t">
                      <td className="py-2 pr-3">{s.setTitle}</td>
                      <td className="py-2 pr-3">{s.actionTitle}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {fmtTargetMmSs(s.targetSec)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {s.successCount}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {s.totalCount}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {rate}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
