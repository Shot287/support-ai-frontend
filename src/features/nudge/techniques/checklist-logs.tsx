// src/features/nudge/techniques/checklist-logs.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/* ===== ローカル表示用の型（既存UI維持） ===== */
type Action = { id: ID; title: string; order: number };
type ChecklistSet = { id: ID; title: string; actions: Action[]; createdAt: number };

/* ===== 同期ユーティリティ ===== */
const USER_ID = "demo";

// テーブル名
const T_SETS = "checklist_sets";
const T_ACTIONS = "checklist_actions";
const T_LOGS = "checklist_action_logs";

// SINCE をテーブル別に分離
const SINCE_KEY = (t: string) => `support-ai:sync:since:${USER_ID}:${t}`;
const getSince = (t: string) => {
  if (typeof window === "undefined") return 0;
  const v = localStorage.getItem(SINCE_KEY(t));
  return v ? Number(v) : 0;
};
const setSince = (t: string, ms: number) => {
  if (typeof window !== "undefined") localStorage.setItem(SINCE_KEY(t), String(ms));
};

// 粘着フラグ：push直後の即時pull判定
const STICKY_KEY = "support-ai:sync:pull:sticky";
const touchSticky = () => {
  try {
    localStorage.setItem(STICKY_KEY, String(Date.now()));
  } catch {}
};

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/* ===== JST ユーティリティ（既存） ===== */
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

/* ===== 表示行（既存） ===== */
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

  // 記録（開始/終了）用：選択状態
  const [selectedSetId, setSelectedSetId] = useState<ID | "">("");
  const [selectedActionId, setSelectedActionId] = useState<ID | "">("");

  const storeRef = useRef({ sets, logs });
  useEffect(() => {
    storeRef.current = { sets, logs };
  }, [sets, logs]);

  /* ===== diffs 反映（Set/Action） ===== */
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

  /* ===== diffs 反映（Action Logs） ===== */
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

  /* ===== 初期 pull + スマート同期 ===== */
  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      try {
        // 3テーブルの最小SINCEでpull
        const sinceMin = Math.min(getSince(T_SETS), getSince(T_ACTIONS), getSince(T_LOGS));
        const json = await pullBatch(USER_ID, sinceMin, [T_SETS, T_ACTIONS, T_LOGS]);
        applySetDiffs(json.diffs.checklist_sets);
        applyActionDiffs(json.diffs.checklist_actions);
        applyLogDiffs(json.diffs.checklist_action_logs);
        setSince(T_SETS, json.server_time_ms);
        setSince(T_ACTIONS, json.server_time_ms);
        setSince(T_LOGS, json.server_time_ms);
      } catch {
        setMsg("同期に失敗しました。しばらくしてから再度お試しください。");
      }
    })();

    const ctl = startSmartSync({
      userId: USER_ID,
      deviceId: getDeviceId(),
      getSince: () => Math.min(getSince(T_SETS), getSince(T_ACTIONS), getSince(T_LOGS)),
      setSince: (ms) => {
        setSince(T_SETS, ms);
        setSince(T_ACTIONS, ms);
        setSince(T_LOGS, ms);
      },
      applyDiffs: (diffs: PullResponse["diffs"]) => {
        applySetDiffs(diffs.checklist_sets);
        applyActionDiffs(diffs.checklist_actions);
        applyLogDiffs(diffs.checklist_action_logs);
      },
      fallbackPolling: true,
      pollingIntervalMs: 30000,
      abortSignal: abort.signal,
    });

    // 粘着フラグ：直近5分は即時 pull
    try {
      const sticky = localStorage.getItem(STICKY_KEY);
      if (sticky && Date.now() - Number(sticky) <= 5 * 60 * 1000) {
        void pullBatch(USER_ID, 0, [T_SETS, T_ACTIONS, T_LOGS]).then((json) => {
          applySetDiffs(json.diffs.checklist_sets);
          applyActionDiffs(json.diffs.checklist_actions);
          applyLogDiffs(json.diffs.checklist_action_logs);
          setSince(T_SETS, json.server_time_ms);
          setSince(T_ACTIONS, json.server_time_ms);
          setSince(T_LOGS, json.server_time_ms);
        });
      }
    } catch {}

    return () => {
      abort.abort();
      ctl.stop();
    };
  }, []);

  /* ===== 記録（開始/終了/削除） ===== */

  const actionsInSelectedSet = useMemo(() => {
    if (!selectedSetId) return [];
    const s = sets.find((x) => x.id === selectedSetId);
    return s ? s.actions : [];
  }, [sets, selectedSetId]);

  // 進行中（end_at_ms が NULL）のログを抽出
  const activeLogs = useMemo(
    () => logs.filter((l) => !l.deleted_at && l.end_at_ms == null),
    [logs]
  );

  // push 後に即 pull する共通処理
  const afterPush = async () => {
    touchSticky();
    const sinceMin = Math.min(getSince(T_SETS), getSince(T_ACTIONS), getSince(T_LOGS));
    const json = await pullBatch(USER_ID, sinceMin, [T_SETS, T_ACTIONS, T_LOGS]);
    applySetDiffs(json.diffs.checklist_sets);
    applyActionDiffs(json.diffs.checklist_actions);
    applyLogDiffs(json.diffs.checklist_action_logs);
    setSince(T_SETS, json.server_time_ms);
    setSince(T_ACTIONS, json.server_time_ms);
    setSince(T_LOGS, json.server_time_ms);
  };

  // 記録開始
  const startLog = async () => {
    if (!selectedSetId || !selectedActionId) {
      alert("セットとアクションを選択してください。");
      return;
    }
    const now = Date.now();
    const id = uid();

    // ローカル先行反映
    setLogs((prev) => [
      {
        id,
        set_id: selectedSetId,
        action_id: selectedActionId,
        start_at_ms: now,
        end_at_ms: null,
        duration_ms: null,
        updated_at: now,
        deleted_at: null,
      } as ChecklistActionLogRow,
      ...prev,
    ]);

    try {
      const deviceId = getDeviceId();
      await pushBatch({
        user_id: USER_ID,
        device_id: deviceId,
        changes: {
          [T_LOGS]: [
            {
              id,
              updated_at: now,
              updated_by: deviceId,
              deleted_at: null,
              set_id: selectedSetId, // 固定FK（必須）
              action_id: selectedActionId,
              data: {
                start_at_ms: now,
                end_at_ms: null,
                duration_ms: null,
              },
            },
          ],
        },
      });
      await afterPush();
    } catch (e) {
      console.warn("[checklist-logs] start push failed:", e);
      setMsg("開始の送信に失敗しました。ネットワークを確認してください。");
    }
  };

  // 記録終了
  const stopLog = async (logId: ID) => {
    const cur = storeRef.current.logs.find((l) => l.id === logId);
    if (!cur || cur.end_at_ms != null) return;

    const end = Date.now();
    const duration = Math.max(0, end - (cur.start_at_ms ?? end));

    // ローカル更新
    setLogs((prev) =>
      prev.map((l) =>
        l.id === cur.id ? { ...l, end_at_ms: end, duration_ms: duration, updated_at: end } : l
      )
    );

    try {
      const deviceId = getDeviceId();
      await pushBatch({
        user_id: USER_ID,
        device_id: deviceId,
        changes: {
          [T_LOGS]: [
            {
              id: cur.id,
              updated_at: end,
              updated_by: deviceId,
              deleted_at: null,
              set_id: cur.set_id,
              action_id: cur.action_id,
              data: {
                start_at_ms: cur.start_at_ms,
                end_at_ms: end,
                duration_ms: duration,
              },
            },
          ],
        },
      });
      await afterPush();
    } catch (e) {
      console.warn("[checklist-logs] stop push failed:", e);
      setMsg("終了の送信に失敗しました。");
    }
  };

  // 記録削除（論理削除）
  const deleteLog = async (logId: ID) => {
    const cur = storeRef.current.logs.find((l) => l.id === logId);
    if (!cur) return;

    setLogs((prev) => prev.filter((l) => l.id !== logId));
    try {
      const deviceId = getDeviceId();
      const now = Date.now();
      await pushBatch({
        user_id: USER_ID,
        device_id: deviceId,
        changes: {
          [T_LOGS]: [
            {
              id: cur.id,
              updated_at: now,
              updated_by: deviceId,
              deleted_at: now, // 論理削除
              set_id: cur.set_id,
              action_id: cur.action_id,
              data: {},
            },
          ],
        },
      });
      await afterPush();
    } catch (e) {
      console.warn("[checklist-logs] delete push failed:", e);
      setMsg("削除の送信に失敗しました。");
    }
  };

  /* ===== 画面用の組み立て（既存） ===== */

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
      {/* 参照ヘッダー（既存） */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-2">記録参照</h2>
        <div className="flex flex-wrap items-center gap-3">
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

      {/* 記録（開始/終了）操作パネル */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h3 className="font-semibold mb-3">記録する</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {/* セット選択 */}
          <div className="grid gap-1">
            <label className="text-sm text-gray-600">セット</label>
            <select
              value={selectedSetId}
              onChange={(e) => {
                const val = e.target.value as ID | "";
                setSelectedSetId(val);
                const first = sets.find((s) => s.id === val)?.actions[0];
                setSelectedActionId(first?.id ?? "");
              }}
              className="rounded-xl border px-3 py-2"
            >
              <option value="">未選択</option>
              {sets
                .slice()
                .sort((a, b) => a.title.localeCompare(b.title, "ja"))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
            </select>
          </div>

          {/* アクション選択 */}
          <div className="grid gap-1">
            <label className="text-sm text-gray-600">アクション</label>
            <select
              value={selectedActionId}
              onChange={(e) => setSelectedActionId(e.target.value as ID)}
              className="rounded-xl border px-3 py-2"
              disabled={!selectedSetId}
            >
              <option value="">未選択</option>
              {actionsInSelectedSet
                .slice()
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              onClick={startLog}
              className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-40"
              disabled={!selectedSetId || !selectedActionId}
            >
              開始
            </button>
          </div>
        </div>

        {/* 進行中一覧（終了/削除） */}
        <div className="mt-4">
          <h4 className="font-medium mb-2">進行中</h4>
          {activeLogs.length === 0 ? (
            <p className="text-sm text-gray-500">進行中の記録はありません。</p>
          ) : (
            <ul className="space-y-2">
              {activeLogs.map((l) => {
                const set = sets.find((s) => s.id === l.set_id);
                const act = set?.actions.find((a) => a.id === l.action_id);
                return (
                  <li
                    key={l.id}
                    className="rounded-xl border p-3 flex items-center justify-between"
                  >
                    <div className="min-w-0">
                      <div className="font-medium break-words">
                        {set?.title} / {act?.title}
                      </div>
                      <div className="text-xs text-gray-600 mt-0.5">
                        開始:{" "}
                        {new Intl.DateTimeFormat("ja-JP", {
                          timeZone: "Asia/Tokyo",
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: false,
                        }).format(new Date(l.start_at_ms!))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => stopLog(l.id)}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        終了
                      </button>
                      <button
                        onClick={() => deleteLog(l.id)}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        削除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* 参照（既存UI） */}
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
                title="同期ログはこの画面からは削除できません（上の「進行中」またはカードから操作してください）"
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
