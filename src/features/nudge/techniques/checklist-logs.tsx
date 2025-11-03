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
  maybeProcrastLogId?: ID;         // 1番目前の先延ばしログの id（合流している場合、一緒に削除）
  procrast: { startAt?: number; endAt?: number; durationMs?: number } | null;
  action: { startAt: number; endAt?: number; durationMs?: number };
};

type RunView = {
  runKey: string;                  // 表示用キー
  setId: ID;
  setTitle: string;
  startedAt: number | null;        // run_start or 最初のログ
  rows: Row[];
  sumAction: number;
  sumPro: number;
  rawLogIds: ID[];                 // このランに含めたログID（削除用、マーカー含む）
};

/* ===== state ===== */
type SetsState = ChecklistSet[];
type LogsState = ChecklistActionLogRow[];

/* ===== SQL ヘルパ（psql用） ===== */
function sqlList(ids: string[]) {
  return ids.map((x) => `'${x.replace(/'/g, "''")}'`).join(", ");
}
function sqlSoftDelete(ids: string[]) {
  if (ids.length === 0) return "";
  return `-- ソフトデリート（推奨）
UPDATE checklist_action_logs
SET deleted_at = (EXTRACT(EPOCH FROM NOW())*1000)::bigint
WHERE id IN (${sqlList(ids)});
`;
}
function sqlHardDelete(ids: string[]) {
  if (ids.length === 0) return "";
  return `-- ハードデリート（最終手段・復元不可）
DELETE FROM checklist_action_logs
WHERE id IN (${sqlList(ids)});
`;
}

/* ===== 削除（ソフトデリート；API経由） ===== */
async function softDeleteLogs(
  userId: string,
  deviceId: string,
  targets: Array<{ id: ID; set_id: ID; action_id: ID; data?: any }>
) {
  if (targets.length === 0) return;
  const updated_at = Date.now();
  const updated_by =
    (typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "9" : "5")
    + "|" + deviceId;

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
  const [order, setOrder] = useState<"asc" | "desc">("asc"); // 使用順の並び
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminSql, setAdminSql] = useState("");

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
        (
          (l.start_at_ms != null && l.start_at_ms >= start && l.start_at_ms <= end) ||
          (l.end_at_ms != null && l.end_at_ms >= start && l.end_at_ms <= end)
        )
    );
  }, [logs, day]);

  /**
   * ラン分割ルール
   * - 明示マーカー：data.kind === "run_start" で新規ラン開始、"run_end" でラン終了
   * - 初手先延ばし：data.kind === "procrastination_before_first" が来た時点で新規ラン扱い
   * - 長いギャップ：直前の action の end から次の start までが閾値以上なら分割
   */
  const GAP_SPLIT_MS = 15 * 60 * 1000; // 15分

  const views: RunView[] = useMemo(() => {
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

      let currentRunLogs: ChecklistActionLogRow[] = [];
      let lastActionEnd: number | null = null;

      const flush = () => {
        if (currentRunLogs.length === 0) return;

        // 1ラン → Row[] 作成
        const rows: Row[] = [];
        let prevEnd: number | null = null;
        let pendingFirstProcrast: { id: ID; startAt: number; endAt: number } | null = null;
        let runStartedAt: number | null = null;
        const rawIds: ID[] = [];

        const pushRowFromAction = (log: ChecklistActionLogRow) => {
          const title =
            set?.actions.find((x) => x.id === log.action_id)?.title ?? "(不明な行動)";
          const actStart = log.start_at_ms ?? 0;
          const actEnd = log.end_at_ms ?? undefined;
          const actDur =
            log.duration_ms ?? (actEnd != null ? Math.max(0, actEnd - actStart) : undefined);

          // 直前先延ばし
          let procrast: Row["procrast"] = null;
          let maybeProcrastLogId: ID | undefined;

          if (pendingFirstProcrast) {
            procrast = {
              startAt: pendingFirstProcrast.startAt,
              endAt: pendingFirstProcrast.endAt,
              durationMs: Math.max(0, pendingFirstProcrast.endAt - pendingFirstProcrast.startAt),
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

        for (const log of currentRunLogs) {
          rawIds.push(log.id);
          const kind = (log as any).data?.kind;

          if (kind === "run_start") {
            runStartedAt = log.start_at_ms ?? log.updated_at ?? runStartedAt ?? null;
            continue; // マーカーは行にしない
          }
          if (kind === "procrastination_before_first") {
            if (log.start_at_ms != null && log.end_at_ms != null) {
              pendingFirstProcrast = {
                id: log.id,
                startAt: log.start_at_ms,
                endAt: log.end_at_ms,
              };
              if (runStartedAt == null) {
                runStartedAt = log.start_at_ms ?? log.updated_at ?? null;
              }
            }
            continue;
          }
          if (kind === "run_end") {
            if (runStartedAt == null) {
              runStartedAt = currentRunLogs[0]?.start_at_ms ?? currentRunLogs[0]?.updated_at ?? null;
            }
            continue;
          }

          // 通常アクション
          if (runStartedAt == null) {
            runStartedAt = log.start_at_ms ?? log.updated_at ?? null;
          }
          pushRowFromAction(log);
        }

        const sumAction = rows.reduce((s, r) => s + (r.action.durationMs ?? 0), 0);
        const sumPro = rows.reduce((s, r) => s + (r.procrast?.durationMs ?? 0), 0);

        if (rows.length > 0) {
          allRuns.push({
            runKey: uid(),
            setId,
            setTitle: set?.title ?? "(不明なセット)",
            startedAt: runStartedAt ?? rows[0].action.startAt ?? null,
            rows,
            sumAction,
            sumPro,
            rawLogIds: rawIds,
          });
        }

        currentRunLogs = [];
        lastActionEnd = null;
      };

      for (const it of items) {
        const kind = (it as any).data?.kind as string | undefined;

        // ラン明示境界
        if (kind === "run_start" || kind === "procrastination_before_first") {
          flush();
          currentRunLogs.push(it);
          lastActionEnd = null;
          continue;
        }

        // 長いギャップで自動分割
        const nextStart = it.start_at_ms ?? it.updated_at ?? null;
        if (lastActionEnd != null && nextStart != null && nextStart - lastActionEnd >= GAP_SPLIT_MS) {
          flush();
        }

        currentRunLogs.push(it);

        // run_end マーカーで即 flush
        if (kind === "run_end") {
          flush();
          continue;
        }

        // アクションなら lastActionEnd を更新
        if (!kind) {
          const endAt = it.end_at_ms ?? null;
          if (endAt != null) lastActionEnd = endAt;
        }
      }

      // 末尾 flush
      flush();
    }

    // 使用順（ランの開始時刻）で並べ替え
    const asc = allRuns
      .slice()
      .sort(
        (a, b) =>
          (a.startedAt ?? 0) - (b.startedAt ?? 0) ||
          a.setTitle.localeCompare(b.setTitle, "ja")
      );

    return order === "asc" ? asc : asc.reverse();
  }, [dayLogs, setMap, order]);

  /* ===== 削除ハンドラ（即時反映＋検証Pull） ===== */
  async function verifyPull() {
    try {
      const json = await pullBatch(USER_ID, getSince(), ["checklist_action_logs"]);
      applyLogDiffs(json.diffs.checklist_action_logs ?? []);
      setSince(json.server_time_ms);
    } catch {
      /* noop */
    }
  }

  const handleDeleteRow = async (_rv: RunView, row: Row) => {
    if (!confirm("この行（合流した先延ばしを含む）を削除しますか？")) return;
    const deviceId = getDeviceId();

    // 対象ログを特定
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

    // 楽観的に即時除去
    const deleteIds = new Set(toDelete.map((d) => d.id));
    setLogs((prev) => prev.filter((l) => !deleteIds.has(l.id)));

    try {
      await softDeleteLogs(USER_ID, deviceId, toDelete);
      setMsg("記録を削除しました。");
    } catch {
      setMsg("削除に失敗しました（サーバ未反映の可能性）。");
      // 失敗時は検証Pullで復元
    } finally {
      // サーバ状態で再検証
      await verifyPull();
    }
  };

  const handleDeleteRun = async (rv: RunView) => {
    if (!confirm("このランの記録をすべて削除しますか？（取り消せません）")) return;
    const deviceId = getDeviceId();

    const targets = dayLogs
      .filter((l) => rv.rawLogIds.includes(l.id))
      .map((l) => ({
        id: l.id,
        set_id: l.set_id,
        action_id: l.action_id,
        data: (l as any).data ?? null,
      }));

    // 楽観的に即時除去
    const ids = new Set(rv.rawLogIds);
    setLogs((prev) => prev.filter((l) => !ids.has(l.id)));

    try {
      await softDeleteLogs(USER_ID, deviceId, targets);
      setMsg("ランの記録を削除しました。");
    } catch {
      setMsg("削除に失敗しました（サーバ未反映の可能性）。");
    } finally {
      await verifyPull();
    }
  };

  /* ====== 管理（psql用SQL生成） ====== */
  function openSqlForRun(v: RunView) {
    const ids = v.rawLogIds;
    const sql = sqlSoftDelete(ids) + "\n" + sqlHardDelete(ids);
    setAdminSql(sql);
    setAdminOpen(true);
  }
  function openSqlForRow(v: RunView, r: Row) {
    const ids = [r.actionLogId, ...(r.maybeProcrastLogId ? [r.maybeProcrastLogId] : [])];
    const sql = sqlSoftDelete(ids) + "\n" + sqlHardDelete(ids);
    setAdminSql(sql);
    setAdminOpen(true);
  }

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
            <button
              onClick={() => setAdminOpen((v) => !v)}
              className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
              title="psql で直接操作したい場合のSQL生成ツールを開閉"
            >
              管理（SQL）
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
          <button
            onClick={() => {
              resetSince();
              setMsg("履歴を含めて再取得しました。");
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

        {adminOpen && (
          <div className="mt-3 space-y-2 rounded-xl border p-3 bg-gray-50">
            <div className="text-xs text-gray-600">
              psql で実行する SQL（<b>まずは UPDATE によるソフトデリートを推奨</b>）。必要に応じて手動で id を編集できます。
            </div>
            <textarea
              className="w-full h-40 rounded-lg border p-2 font-mono text-xs"
              value={adminSql}
              onChange={(e) => setAdminSql(e.target.value)}
            />
            <div className="text-xs text-gray-500">
              テーブル名: <code>checklist_action_logs</code>（変更している場合は合わせて修正してください）
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500 mt-2">
          指定日のJSTに含まれる同期ログを表示します。使用（ラン）単位で区切り、下ほど新しい使用になります（トグルで反転可）。
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
                  <span className="text-xs text-gray-500">
                    開始: {fmtTime(v.startedAt)}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openSqlForRun(v)}
                  className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
                  title="このランのログIDを使ったSQL（UPDATE/DELETE）を生成して管理パネルに表示"
                >
                  SQL(このラン)
                </button>
                <button
                  onClick={() => void handleDeleteRun(v)}
                  className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
                  title="このランに含まれるログ（run_start / run_end / 先延ばしマーカー含む）をすべて削除します"
                >
                  ランを削除
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full text-sm">
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
                        <div className="flex gap-1">
                          <button
                            onClick={() => openSqlForRow(v, r)}
                            className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                            title="この行（＋合流の先延ばし分）のIDでSQLを生成して管理パネルに表示"
                          >
                            SQL(行)
                          </button>
                          <button
                            onClick={() => void handleDeleteRow(v, r)}
                            className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                            title="この行（合流した先延ばしを含む）を削除"
                          >
                            行を削除
                          </button>
                        </div>
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
