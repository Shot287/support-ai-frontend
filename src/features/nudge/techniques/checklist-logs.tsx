// src/features/nudge/techniques/checklist-logs.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type ID = string;

type Action = { id: ID; title: string; order: number };
type ChecklistSet = { id: ID; title: string; actions: Action[]; createdAt: number };
type ActionLog = { actionId: ID; startAt: number; endAt?: number; durationMs?: number };
type ProcrastinationLog = { fromActionId: ID | null; startAt: number; endAt?: number; durationMs?: number };
type Run = {
  id: ID; setId: ID; startedAt: number; endedAt?: number;
  actions: ActionLog[]; procrastinations: ProcrastinationLog[];
};
type Store = { sets: ChecklistSet[]; runs: Run[]; current?: unknown; version: 1 };

const KEY = "checklist_v1";

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

/* ====== ストアのロード/セーブ ====== */
function load(): Store {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return { sets: [], runs: [], version: 1 };
    const parsed = JSON.parse(raw) as Store;
    return parsed?.version ? parsed : { sets: [], runs: [], version: 1 };
  } catch {
    return { sets: [], runs: [], version: 1 };
  }
}
function save(s: Store) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s));
}

/* ===== 表示用：行動＋直前先延ばし ===== */
type Row = {
  actionTitle: string;
  procrast: { startAt?: number; endAt?: number; durationMs?: number } | null;
  action: { startAt: number; endAt?: number; durationMs?: number };
};

export default function ChecklistLogs() {
  const [store, setStore] = useState<Store>(() => load());
  useEffect(() => {
    const on = () => setStore(load());
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);

  const [date, setDate] = useState<string>(() => dateToYmdJst(new Date()));

  const setMap = useMemo(
    () => new Map(store.sets.map((s) => [s.id, s] as const)),
    [store.sets]
  );

  const range = useMemo(() => dayRangeJst(date), [date]);

  // 選択日に重なるラン
  const runs = useMemo(() => {
    const { start, end } = range;
    const overlap = (t?: number) => t != null && t >= start && t <= end;
    return store.runs.filter((r) => {
      const hitAction = r.actions.some((a) => overlap(a.startAt) || overlap(a.endAt));
      const hitP = r.procrastinations.some((p) => overlap(p.startAt) || overlap(p.endAt));
      return hitAction || hitP;
    });
  }, [store.runs, range]);

  const view = useMemo(() => {
    return runs.map((run) => {
      const set = setMap.get(run.setId);
      const actionsSorted = run.actions
        .slice()
        .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0));
      const procrastSorted = run.procrastinations
        .slice()
        .sort((a, b) => (a.endAt ?? a.startAt) - (b.endAt ?? b.startAt));

      const rows: Row[] = [];
      let pIdx = 0;

      for (const a of actionsSorted) {
        // 直前先延ばしを拾う
        let picked: ProcrastinationLog | null = null;
        while (pIdx < procrastSorted.length) {
          const candidate = procrastSorted[pIdx];
          if (candidate.endAt && candidate.endAt <= a.startAt) {
            picked = candidate;
            pIdx++;
          } else break;
        }
        const title =
          set?.actions.find((x) => x.id === a.actionId)?.title ?? "(不明な行動)";

        rows.push({
          actionTitle: title,
          procrast: picked
            ? {
                startAt: picked.startAt,
                endAt: picked.endAt,
                durationMs: picked.durationMs,
              }
            : null,
          action: {
            startAt: a.startAt,
            endAt: a.endAt,
            durationMs: a.durationMs,
          },
        });
      }

      const sumAction = rows.reduce((s, r) => s + (r.action.durationMs ?? 0), 0);
      const sumPro = rows.reduce((s, r) => s + (r.procrast?.durationMs ?? 0), 0);

      return {
        runId: run.id,
        setTitle: set?.title ?? "(不明なセット)",
        rows,
        sumAction,
        sumPro,
      };
    });
  }, [runs, setMap]);

  const fmtTime = (t?: number) =>
    t == null ? "…" : new Date(t).toLocaleTimeString("ja-JP", { hour12: false });

  const fmtDur = (ms?: number) =>
    ms == null ? "—" : `${Math.floor(ms / 60000)}分${Math.floor((ms % 60000) / 1000)}秒`;

  /* ==== 記録（Run）削除 ==== */
  const deleteRun = (runId: ID) => {
    if (!confirm("この記録（Run）を削除しますか？この操作は元に戻せません。")) return;
    setStore((prev) => {
      const next = { ...prev, runs: prev.runs.filter((r) => r.id !== runId) };
      save(next);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-2">記録参照</h2>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">日付:</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border px-3 py-2"
          />
        </div>
        <p className="text-xs text-gray-500 mt-2">
          指定日のJSTに含まれる記録を表示します（各行は「直前の先延ばし → 行動」のセット）。
        </p>
      </section>

      {view.length === 0 ? (
        <p className="text-sm text-gray-500">指定日の記録はありません。</p>
      ) : (
        view.map((v) => (
          <section key={v.runId} className="rounded-2xl border p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold">{v.setTitle}</h3>
                <div className="text-xs text-gray-500">Run: {v.runId.slice(0, 8)}…</div>
              </div>
              <button
                onClick={() => deleteRun(v.runId)}
                className="rounded-xl border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                title="この記録（Run）を削除します"
              >
                記録を削除
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-sm">
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
                  </tr>
                </thead>
                <tbody>
                  {v.rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-2 pr-3 tabular-nums">{i + 1}</td>
                      <td className="py-2 pr-3">{r.actionTitle}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtTime(r.procrast?.startAt)}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtTime(r.procrast?.endAt)}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtDur(r.procrast?.durationMs)}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtTime(r.action.startAt)}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtTime(r.action.endAt)}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtDur(r.action.durationMs)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-medium">
                    <td className="py-2 pr-3" colSpan={4}>合計</td>
                    <td className="py-2 pr-3 tabular-nums">{fmtDur(v.sumPro)}</td>
                    <td className="py-2 pr-3" colSpan={2}></td>
                    <td className="py-2 pr-3 tabular-nums">{fmtDur(v.sumAction)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
