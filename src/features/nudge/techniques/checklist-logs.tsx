// src/features/nudge/techniques/checklist-logs.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  startSmartSync,
  pullBatch,
  pushBatch,
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

/**
 * 他画面と since を共有すると、当日の古いログが pull 範囲から漏れる可能性があるため、
 * ログ画面専用キーを使用。
 */
const SINCE_KEY = `support-ai:sync:since:${USER_ID}:checklist-logs`;

const getSince = () => {
  if (typeof window === "undefined") return 0;
  const v = localStorage.getItem(SINCE_KEY);
  return v ? Number(v) : 0;
};
const setSince = (ms: number) => {
  if (typeof window !== "undefined") localStorage.setItem(SINCE_KEY, String(ms));
};
/** 必要に応じて“全期間再取得”に戻す（内部用） */
const resetSince = () => {
  if (typeof window !== "undefined") localStorage.setItem(SINCE_KEY, "0");
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

/* ===== 表示行 ===== */
type Row = {
  actionTitle: string;
  actionLogId: ID;                 // 行動ログの id（削除に使用）
  maybeProcrastLogId?: ID;         // 1番目前の先延ばしログの id（存在時の一括削除用）
  procrast: { startAt?: number; endAt?: number; durationMs?: number } | null;
  action: { startAt: number; endAt?: number; durationMs?: number };
};

type RunView = {
  runKey: string;                  // 表示用キー
  setId: ID;
  setTitle: string;
  startedAt: number | null;        // ★ null 許容に変更（代入側の null と整合）
  rows: Row[];
  sumAction: number;
  sumPro: number;
  rawLogIds: ID[];                 // このランに含めたログID（削除に使用、マーカー含む）
};

/* ===== state ===== */
type SetsState = ChecklistSet[];
type LogsState = ChecklistActionLogRow[];

/* ===== 削除（ソフトデリート） ===== */
async function softDeleteLogs(
  userId: string,
  deviceId: string,
  targets: Array<{ id: ID; set_id: ID; action_id: ID; data?: any }>
) {
  if (targets.length === 0) return;
  const updated_at = Date.now();
  const updated_by =
    (typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "9" : "5") +
    "|" +
    deviceId;

  const checklist_action_logs = targets.map((t) => ({
    id: t.id,
    set_id: t.set_id,
    action_id: t.action_id,
    updated_at,
    updated_by,
    deleted_at: updated_at,
    data: t.data ?? null,
  }));

  await pushBatch({
    user_id: userId,
    device_id: deviceId,
    changes: {
      checklist_sets: [],
      checklist_actions: [],
      checklist_action_logs,
    },
  });
}

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
      for (const x of prev) if (!x.deleted_at) map.set(x.id, x);
      for (const r of rows) {
        if (r.deleted_at) {
          map.delete(r.id);
        } else {
          map.set(r.id, r as ChecklistActionLogRow);
        }
      }
      // start_at（→同時刻なら updated_at）で安定ソート
      return Array.from(map.values()).sort(
        (a, b) =>
          (a.start_at_ms ?? 0) - (b.start_at_ms ?? 0) ||
          (a.updated_at ?? 0) - (b.updated_at ?? 0)
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
        applySetDiffs(json.diffs.checklist_sets ?? []);
        applyActionDiffs(json.diffs.checklist_actions ?? []);
        applyLogDiffs(json.diffs.checklist_action_logs ?? []);
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
        applySetDiffs(diffs.checklist_sets ?? []);
        applyActionDiffs(diffs.checklist_actions ?? []);
        applyLogDiffs(diffs.checklist_action_logs ?? []);
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

  /**
   * ★ 過去日選択時、since が進み過ぎていると当該日のログが pull 範囲外になる。
   * その場合のみ 1 回だけバックフィル（since=0）を行う。
   */
  useEffect(() => {
    const ensureBackfillForDate = async () => {
      try {
        const { end } = dayRangeJst(date);
        const since = getSince();
        const marginMs = 5 * 60 * 1000;
        if (end + marginMs < since) {
          const json = await pullBatch(USER_ID, 0, [
            "checklist_sets",
            "checklist_actions",
            "checklist_action_logs",
          ]);
          applySetDiffs(json.diffs.checklist_sets ?? []);
          applyActionDiffs(json.diffs.checklist_actions ?? []);
          applyLogDiffs(json.diffs.checklist_action_logs ?? []);
          setSince(json.server_time_ms);
        }
      } catch {
        /* noop */
      }
    };
    void ensureBackfillForDate();
  }, [date]);

  /* ===== 画面用の組み立て ===== */
  const setMap = useMemo(() => new Map(sets.map((s) => [s.id, s] as const)), [sets]);

  const day = useMemo(() => dayRangeJst(date), [date]);

  // 対象日のログのみ抽出（start か end が当日範囲にかかるもの）
  const dayLogs = useMemo(() => {
    const { start, end } = day;
    return logs.filter(
      (l) =>
        !l.deleted_at &&
        ((l.start_at_ms != null && l.start_at_ms >= start && l.start_at_ms <= end) ||
          (l.end_at_ms != null && l.end_at_ms >= start && l.end_at_ms <= end))
    );
  }, [logs, day]);

  /**
   * ラン単位に分割してから、ランの開始時刻（run_start か最初のログ）で昇順整列。
   * 表示は「古い → 新しい」（＝新しいほど下）。
   * - run_start（data.kind==="run_start"）でランを切る
   * - procrastination_before_first は該当アクションの「直前先延ばし」に合流させる
   * - それ以外の隙間は通常のギャップ先延ばしとして算出
   */
  const views: RunView[] = useMemo(() => {
    // セットごとに当日ログを処理
    const bySet = new Map<string, ChecklistActionLogRow[]>();
    for (const r of dayLogs) {
      if (!bySet.has(r.set_id)) bySet.set(r.set_id, []);
      bySet.get(r.set_id)!.push(r);
    }

    const allRuns: RunView[] = [];

    for (const [setId, itemsRaw] of bySet.entries()) {
      const set = setMap.get(setId);
      const items = itemsRaw
        .slice()
        .sort(
          (a, b) =>
            (a.start_at_ms ?? 0) - (b.start_at_ms ?? 0) ||
            (a.updated_at ?? 0) - (b.updated_at ?? 0)
        );

      // ラン切り分け
      let currentRunLogs: ChecklistActionLogRow[] = [];
      const flush = () => {
        if (currentRunLogs.length === 0) return;

        // 1ランを Row[] に変換
        const rows: Row[] = [];
        let prevEnd: number | null = null;
        let pendingFirstProcrast: { id: ID; startAt: number; endAt: number } | null =
          null;

        const pushRow = (log: ChecklistActionLogRow) => {
          const title =
            set?.actions.find((x) => x.id === log.action_id)?.title ?? "(不明な行動)";
          const actStart = log.start_at_ms ?? 0;
          const actEnd = log.end_at_ms ?? undefined;
          const actDur =
            log.duration_ms ??
            (actEnd != null ? Math.max(0, actEnd - actStart) : undefined);

          // 直前先延ばし
          let procrast: Row["procrast"] = null;
          let maybeProcrastLogId: ID | undefined;

          if (pendingFirstProcrast) {
            procrast = {
              startAt: pendingFirstProcrast.startAt,
              endAt: pendingFirstProcrast.endAt,
              durationMs: Math.max(
                0,
                pendingFirstProcrast.endAt - pendingFirstProcrast.startAt
              ),
            };
            maybeProcrastLogId = pendingFirstProcrast.id;
            pendingFirstProcrast = null;
          } else if (prevEnd != null && actStart > prevEnd) {
            procrast = { startAt: prevEnd, endAt: actStart, durationMs: actStart - prevEnd };
          }

          rows.push({
            actionTitle: title,
            actionLogId: log.id,
            maybeProcrastLogId,
            procrast,
            action: { startAt: actStart, endAt: actEnd, durationMs: actDur },
          });

          if (actEnd != null) prevEnd = actEnd;
        };

        // ラン内部ログを巡回
        let runStartAt: number | undefined = undefined;
        for (const log of currentRunLogs) {
          const kind = (log as any).data?.kind;
          if (kind === "run_start") {
            runStartAt = log.start_at_ms ?? log.updated_at ?? runStartAt;
            continue; // マーカーは行にしない
          }
          if (kind === "procrastination_before_first") {
            if (log.start_at_ms != null && log.end_at_ms != null) {
              pendingFirstProcrast = {
                id: log.id,
                startAt: log.start_at_ms,
                endAt: log.end_at_ms,
              };
            }
            continue; // 次の実アクションに合流
          }
          // 通常アクションログ
          pushRow(log);
        }

        const sumAction = rows.reduce((s, r) => s + (r.action.durationMs ?? 0), 0);
        const sumPro = rows.reduce((s, r) => s + (r.procrast?.durationMs ?? 0), 0);

        const rawLogIds = currentRunLogs.map((x) => x.id);
        allRuns.push({
          runKey: uid(),
          setId,
          setTitle: set?.title ?? "(不明なセット)",
          startedAt: runStartAt ?? (currentRunLogs[0]?.start_at_ms ?? null), // ★ null に正規化
          rows,
          sumAction,
          sumPro,
          rawLogIds,
        });

        currentRunLogs = [];
      };

      for (const it of items) {
        const kind = (it as any).data?.kind;
        if (kind === "run_start") {
          // 直前のランを確定してから新ラン開始
          flush();
          currentRunLogs.push(it);
        } else {
          currentRunLogs.push(it);
        }
      }
      // 末尾 flush
      flush();
    }

    // 使用順で並べる（古い→新しい＝新しいほど下に来る）
    return allRuns.sort(
      (a, b) =>
        (a.startedAt ?? 0) - (b.startedAt ?? 0) ||
        a.setTitle.localeCompare(b.setTitle, "ja")
    );
  }, [dayLogs, setMap]);

  /* ===== 削除ハンドラ ===== */
  const handleDeleteRow = async (_rv: RunView, row: Row) => {
    if (!confirm("この行（先延ばし含む）を削除しますか？")) return;
    const deviceId = getDeviceId();

    // 表示行に紐づく actionLog を必ず削除。
    // 先延ばしが「procrastination_before_first」で合流している場合は、そのログIDも一緒に削除。
    const toDelete: Array<{ id: ID; set_id: ID; action_id: ID; data?: any }> = [];

    const actionLog = dayLogs.find((l) => l.id === row.actionLogId);
    if (actionLog) {
      toDelete.push({
        id: actionLog.id,
        set_id: actionLog.set_id,
        action_id: actionLog.action_id,
        data: (actionLog as any).data ?? null,
      });
    }

    if (row.maybeProcrastLogId) {
      const proLog = dayLogs.find((l) => l.id === row.maybeProcrastLogId);
      if (proLog) {
        toDelete.push({
          id: proLog.id,
          set_id: proLog.set_id,
          action_id: proLog.action_id,
          data: (proLog as any).data ?? null,
        });
      }
    }

    try {
      await softDeleteLogs(USER_ID, deviceId, toDelete);
      // ローカル即時反映
      setLogs((prev) => prev.filter((l) => !toDelete.some((d) => d.id === l.id)));
      setMsg("記録を削除しました。");
    } catch {
      setMsg("削除に失敗しました。");
    }
  };

  const handleDeleteRun = async (rv: RunView) => {
    if (!confirm("このランの記録をすべて削除しますか？（取り消せません）")) return;
    const deviceId = getDeviceId();

    // run に含めた rawLogIds（run_start を含む）を一括削除
    const targets = dayLogs
      .filter((l) => rv.rawLogIds.includes(l.id))
      .map((l) => ({
        id: l.id,
        set_id: l.set_id,
        action_id: l.action_id,
        data: (l as any).data ?? null,
      }));

    try {
      await softDeleteLogs(USER_ID, deviceId, targets);
      setLogs((prev) => prev.filter((l) => !rv.rawLogIds.includes(l.id)));
      setMsg("ランの記録を削除しました。");
    } catch {
      setMsg("削除に失敗しました。");
    }
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
        {msg && <p className="text-xs text-gray-500 mt-2">{msg}</p>}
        <div className="mt-2">
          <button
            onClick={() => {
              resetSince();
              setMsg("履歴を含めて再取得しました。");
              // 直後に1回だけ強制 pull（バックフィル）
              (async () => {
                try {
                  const json = await pullBatch(USER_ID, 0, [
                    "checklist_sets",
                    "checklist_actions",
                    "checklist_action_logs",
                  ]);
                  applySetDiffs(json.diffs.checklist_sets ?? []);
                  applyActionDiffs(json.diffs.checklist_actions ?? []);
                  applyLogDiffs(json.diffs.checklist_action_logs ?? []);
                  setSince(json.server_time_ms);
                } catch {
                  setMsg("再取得に失敗しました。");
                }
              })();
            }}
            className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
            title="当日のみならず、過去分も含めて再取得します"
          >
            全履歴を再取得
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          指定日のJSTに含まれる同期ログを表示します。下に行くほど新しい使用（ラン）です。
        </p>
      </section>

      {views.length === 0 ? (
        <p className="text-sm text-gray-500">指定日の記録はありません。</p>
      ) : (
        views.map((v) => (
          <section key={v.runKey} className="rounded-2xl border p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold">{v.setTitle}</h3>
                {v.startedAt != null && (
                  <span className="text-xs text-gray-500">開始: {fmtTime(v.startedAt)}</span>
                )}
              </div>
              <button
                onClick={() => void handleDeleteRun(v)}
                className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
                title="このランに含まれるログ（run_start 含む）をすべて削除します"
              >
                ランを削除
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[820px] w-full text-sm">
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
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {v.rows.map((r, i) => (
                    <tr key={r.actionLogId} className="border-t">
                      <td className="py-2 pr-3 tabular-nums">{i + 1}</td>
                      <td className="py-2 pr-3">{r.actionTitle}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtTime(r.procrast?.startAt)}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtTime(r.procrast?.endAt)}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtDur(r.procrast?.durationMs)}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtTime(r.action.startAt)}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtTime(r.action.endAt)}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtDur(r.action.durationMs)}</td>
                      <td className="py-2 pr-3">
                        <button
                          onClick={() => void handleDeleteRow(v, r)}
                          className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                          title="この行（先延ばしログが合流している場合はそれも）を削除"
                        >
                          行を削除
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t font-medium">
                    <td className="py-2 pr-3" colSpan={4}>
                      合計
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{fmtDur(v.sumPro)}</td>
                    <td className="py-2 pr-3" colSpan={2}></td>
                    <td className="py-2 pr-3 tabular-nums">{fmtDur(v.sumAction)}</td>
                    <td className="py-2 pr-3"></td>
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
