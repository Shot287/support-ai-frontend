// src/features/nudge/techniques/checklist-logs.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  startSmartSync,
  pullBatch,
  type PullResponse,
  type ChecklistSetRow,
  type ChecklistActionRow,
  type ChecklistActionLogRow,
} from "@/lib/sync";
import { getDeviceId } from "@/lib/device";

type ID = string;

/* ===== ローカル表示用の型 ===== */
type Action = { id: ID; title: string; order: number };
type ChecklistSet = { id: ID; title: string; actions: Action[]; createdAt: number };

/* ===== 同期ユーティリティ ===== */
const USER_ID = "demo";
const SINCE_KEY = `support-ai:sync:since:${USER_ID}`;
const getSince = () => {
  if (typeof window === "undefined") return 0;
  const v = localStorage.getItem(SINCE_KEY);
  return v ? Number(v) : 0;
};
const setSince = (ms: number) => {
  if (typeof window !== "undefined") localStorage.setItem(SINCE_KEY, String(ms));
};

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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
  t == null ? "…" : new Date(t).toLocaleTimeString("ja-JP", { hour12: false });
const fmtDur = (ms?: number | null) =>
  ms == null ? "—" : `${Math.floor(ms / 60000)}分${Math.floor((ms % 60000) / 1000)}秒`;

/* ===== 表示行：直前先延ばし + 行動 ===== */
type Row = {
  actionTitle: string;
  procrast: { startAt?: number; endAt?: number; durationMs?: number } | null;
  action: { startAt: number; endAt?: number; durationMs?: number };
};

/* ===== state ===== */
type SetsState = ChecklistSet[];
type LogsState = ChecklistActionLogRow[];

export default function ChecklistLogs() {
  const [sets, setSets] = useState<SetsState>([]);
  const [logs, setLogs] = useState<LogsState>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [date, setDate] = useState<string>(() => dateToYmdJst(new Date()));

  // ---- diffs 反映（Set/Action） ----
  const applySetDiffs = (rows: readonly ChecklistSetRow[] = []) => {
    if (rows.length === 0) return;
    setSets((prev) => {
      const idx = new Map(prev.map((s, i) => [s.id, i] as const));
      const next = prev.slice();
      for (const r of rows) {
        if (r.deleted_at) {
          const i = idx.get(r.id);
          if (i != null) {
            next.splice(i, 1);
            idx.clear();
            next.forEach((s, k) => idx.set(s.id, k));
          }
          continue;
        }
        const i = idx.get(r.id);
        if (i == null) {
          next.push({
            id: r.id,
            title: r.title,
            actions: [],
            createdAt: r.updated_at ?? Date.now(),
          });
          idx.set(r.id, next.length - 1);
        } else {
          next[i] = { ...next[i], title: r.title };
        }
      }
      return next;
    });
  };

  const applyActionDiffs = (rows: readonly ChecklistActionRow[] = []) => {
    if (rows.length === 0) return;
    setSets((prev) => {
      const bySet = new Map<string, ChecklistActionRow[]>();
      for (const r of rows) {
        if (!bySet.has(r.set_id)) bySet.set(r.set_id, []);
        bySet.get(r.set_id)!.push(r);
      }
      return prev.map((set) => {
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
              order: (r as any).order ?? actions.length,
            });
            idx.set(r.id, actions.length - 1);
          } else {
            actions[i] = {
              ...actions[i],
              title: r.title,
              order: (r as any).order ?? actions[i].order,
            };
          }
        }
        actions = actions
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((a, i) => ({ ...a, order: i }));
        return { ...set, actions };
      });
    });
  };

  // ---- diffs 反映（Action Logs） ----
  const applyLogDiffs = (rows: readonly ChecklistActionLogRow[] = []) => {
    if (rows.length === 0) return;
    setLogs((prev) => {
      const map = new Map<string, ChecklistActionLogRow>();
      for (const x of prev) map.set(x.id, x);
      for (const r of rows) {
        if (r.deleted_at) {
          map.delete(r.id);
        } else {
          map.set(r.id, r as ChecklistActionLogRow);
        }
      }
      return Array.from(map.values()).sort(
        (a, b) => (a.updated_at ?? 0) - (b.updated_at ?? 0)
      );
    });
  };

  // ---- 初期 pull + スマート同期 ----
  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      try {
        const json = await pullBatch(USER_ID, getSince(), [
          "checklist_sets",
          "checklist_actions",
          "checklist_action_logs",
        ]);
        applySetDiffs(json.diffs.checklist_sets);
        applyActionDiffs(json.diffs.checklist_actions);
        applyLogDiffs(json.diffs.checklist_action_logs);
        setSince(json.server_time_ms);
      } catch {
        setMsg("同期に失敗しました。しばらくしてから再度お試しください。");
      }
    })();

    const ctl = startSmartSync({
      userId: USER_ID,
      deviceId: getDeviceId(),
      getSince,
      setSince,
      applyDiffs: (diffs: PullResponse["diffs"]) => {
        applySetDiffs(diffs.checklist_sets);
        applyActionDiffs(diffs.checklist_actions);
        applyLogDiffs(diffs.checklist_action_logs);
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

  /* ===== 画面用の組み立て ===== */

  const setMap = useMemo(() => new Map(sets.map((s) => [s.id, s] as const)), [sets]);

  const day = useMemo(() => dayRangeJst(date), [date]);
  const dayLogs = useMemo(() => {
    const { start, end } = day;
    return logs.filter(
      (l) =>
        (l.start_at_ms != null && l.start_at_ms >= start && l.start_at_ms <= end) ||
        (l.end_at_ms != null && l.end_at_ms >= start && l.end_at_ms <= end)
    );
  }, [logs, day]);

  const view = useMemo(() => {
    const bySet = new Map<string, ChecklistActionLogRow[]>();
    for (const r of dayLogs) {
      if (!bySet.has(r.set_id)) bySet.set(r.set_id, []);
      bySet.get(r.set_id)!.push(r);
    }

    const list = Array.from(bySet.entries()).map(([setId, items]) => {
      const set = setMap.get(setId);
      items.sort(
        (a, b) =>
          (a.start_at_ms ?? 0) - (b.start_at_ms ?? 0) ||
          (a.updated_at ?? 0) - (b.updated_at ?? 0)
      );
      const rows: Row[] = [];
      let prevEnd: number | null = null;

      for (const it of items) {
        const title =
          set?.actions.find((x) => x.id === it.action_id)?.title ?? "(不明な行動)";
        const actStart = it.start_at_ms ?? undefined;
        const actEnd = it.end_at_ms ?? undefined;
        const actDur =
          it.duration_ms ??
          (actStart != null && actEnd != null ? actEnd - actStart : undefined);

        let procrast: Row["procrast"] = null;
        if (prevEnd != null && actStart != null && actStart > prevEnd) {
          procrast = { startAt: prevEnd, endAt: actStart, durationMs: actStart - prevEnd };
        }

        rows.push({
          actionTitle: title,
          procrast,
          action: { startAt: actStart ?? 0, endAt: actEnd, durationMs: actDur },
        });

        prevEnd = actEnd ?? prevEnd;
      }

      const sumAction = rows.reduce((s, r) => s + (r.action.durationMs ?? 0), 0);
      const sumPro = rows.reduce((s, r) => s + (r.procrast?.durationMs ?? 0), 0);

      return {
        runId: uid(),
        setTitle: set?.title ?? "(不明なセット)",
        rows,
        sumAction,
        sumPro,
      };
    });

    return list.sort((a, b) => a.setTitle.localeCompare(b.setTitle, "ja"));
  }, [dayLogs, setMap]);

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
          {msg && <span className="text-xs text-gray-500">{msg}</span>}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          指定日のJSTに含まれる同期ログを表示します（各行は「直前の先延ばし → 行動」のセット）。
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
              </div>
              <button
                disabled
                className="rounded-xl border px-3 py-1.5 text-sm text-gray-400"
                title="同期ログはこの画面からは削除できません"
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
                    <td className="py-2 pr-3" colSpan={4}>
                      合計
                    </td>
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
