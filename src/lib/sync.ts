// frontend/src/lib/sync.ts
// ===================================================
// ✅ Support-AI 同期ライブラリ（最新版 / Render対応）
// ===================================================

/* =====================
 * 型定義
 * ===================== */
export type ChecklistSetRow = {
  id: string;
  user_id: string;
  title: string;
  order: number;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
};

export type ChecklistActionRow = {
  id: string;
  user_id: string;
  set_id: string;
  title: string;
  order: number;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
};

export type ChecklistActionLogRow = {
  id: string;
  user_id: string;
  set_id: string;
  action_id: string;
  start_at_ms: number | null;
  end_at_ms: number | null;
  duration_ms: number | null;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
};

export type PullResponse = {
  server_time_ms: number;
  diffs: {
    checklist_sets: ChecklistSetRow[];
    checklist_actions: ChecklistActionRow[];
    checklist_action_logs: ChecklistActionLogRow[];
  };
};

/* =====================
 * 定数・共通設定
 * ===================== */
const BACKEND = process.env.NEXT_PUBLIC_BACKEND!;
const APP_KEY = process.env.NEXT_PUBLIC_APP_KEY!;
const nowMs = () => Date.now();

const DEFAULT_TABLES = [
  "checklist_sets",
  "checklist_actions",
  "checklist_action_logs",
] as const;
export type TableName = (typeof DEFAULT_TABLES)[number];

const isMobileDevice = () =>
  typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

const makeUpdatedBy = (deviceId: string) =>
  `${isMobileDevice() ? "9" : "5"}|${deviceId}`;
const makeUpdatedAt = () => (isMobileDevice() ? nowMs() + 2 : nowMs());

/* =====================
 * 共通 fetch ラッパー
 * ===================== */
export async function apiGet<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    ...init,
    headers: {
      "x-app-key": APP_KEY,
      "accept": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function apiPost<T = any>(path: string, body: any, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "x-app-key": APP_KEY,
      "content-type": "application/json",
      "accept": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/* =====================
 * 差分取得 (pull)
 * ===================== */
export async function pullBatch(
  userId: string,
  since: number,
  tables: readonly TableName[] = DEFAULT_TABLES
) {
  const qs = new URLSearchParams({
    user_id: userId,
    since: String(since || 0),
    tables: tables.join(","),
  });
  return apiGet<PullResponse>(`/api/sync/pull-batch?${qs.toString()}`);
}

/* =====================
 * 変更送信 (push)
 * ===================== */
function pushBatchPayload(params: {
  userId: string;
  deviceId: string;
  sets?: any[];
  actions?: any[];
  action_logs?: any[];
}) {
  const { userId, deviceId, sets = [], actions = [], action_logs = [] } = params;
  return {
    user_id: userId,
    device_id: deviceId,
    changes: {
      checklist_sets: sets,
      checklist_actions: actions,
      checklist_action_logs: action_logs,
    },
  };
}

export async function pushBatch(body: any) {
  return apiPost(`/api/sync/push-batch`, body);
}

/* =====================
 * ポーリング
 * ===================== */
export function startChecklistPolling(opts: {
  userId: string;
  deviceId: string;
  getSince: () => number;
  setSince: (ms: number) => void;
  applyDiffs: (diffs: PullResponse["diffs"]) => void;
  intervalMs?: number;
  tables?: readonly TableName[];
  abortSignal?: AbortSignal;
}) {
  const { userId, getSince, setSince, applyDiffs, intervalMs = 15000, tables = DEFAULT_TABLES, abortSignal } = opts;
  let timer: any;

  async function tick() {
    try {
      const resp = await pullBatch(userId, getSince(), tables);
      applyDiffs(resp.diffs);
      setSince(resp.server_time_ms);
    } catch (e) {
      console.warn("[sync] pull failed:", e);
    }
    schedule();
  }

  function schedule() {
    if (abortSignal?.aborted) return;
    timer = setTimeout(tick, intervalMs);
  }

  schedule();
  abortSignal?.addEventListener("abort", () => timer && clearTimeout(timer));

  return { stop() { if (timer) clearTimeout(timer); } };
}

/* =====================
 * SSE（リアルタイム同期）
 * ===================== */
export function startRealtimeSync(opts: {
  userId: string;
  getSince: () => number;
  setSince: (ms: number) => void;
  applyDiffs: (diffs: PullResponse["diffs"]) => void;
  tables?: readonly TableName[];
  abortSignal?: AbortSignal;
}) {
  const { userId, getSince, setSince, applyDiffs, tables = DEFAULT_TABLES, abortSignal } = opts;
  if (typeof window === "undefined") return { stop() {} };

  const qs = new URLSearchParams({
    user_id: userId,
    since: String(getSince() || 0),
    tables: tables.join(","),
    app_key: APP_KEY, // ← SSEはヘッダ不可なのでURLにapp_keyを付与
  });
  const es = new EventSource(`${BACKEND}/api/sync/stream-sse?${qs.toString()}`, { withCredentials: false });

  es.onmessage = (ev) => {
    try {
      const payload = JSON.parse(ev.data) as PullResponse;
      applyDiffs(payload.diffs);
      setSince(payload.server_time_ms);
    } catch (e) {
      console.warn("[SSE] parse error:", e);
    }
  };
  es.onerror = (err) => console.warn("[SSE] error:", err);

  const stop = () => { try { es.close(); } catch {} };
  abortSignal?.addEventListener("abort", stop);
  return { stop };
}

/* =====================
 * スマート同期（SSE+Fallback）
 * ===================== */
export function startSmartSync(opts: {
  userId: string;
  deviceId: string;
  getSince: () => number;
  setSince: (ms: number) => void;
  applyDiffs: (diffs: PullResponse["diffs"]) => void;
  tables?: readonly TableName[];
  fallbackPolling?: boolean;
  pollingIntervalMs?: number;
  abortSignal?: AbortSignal;
}) {
  const { userId, deviceId, getSince, setSince, applyDiffs, tables = DEFAULT_TABLES, fallbackPolling = true, pollingIntervalMs = 30000, abortSignal } = opts;
  const sseCtl = startRealtimeSync({ userId, getSince, setSince, applyDiffs, tables, abortSignal });
  let pollCtl: { stop: () => void } | undefined;

  if (fallbackPolling) {
    pollCtl = startChecklistPolling({
      userId, deviceId, getSince, setSince, applyDiffs, tables,
      intervalMs: pollingIntervalMs, abortSignal,
    });
  }

  return { stop() { sseCtl.stop(); pollCtl?.stop(); } };
}

/* =====================
 * Upsert/Delete API
 * ===================== */
export async function upsertChecklistSet(p: { userId: string; deviceId: string; id: string; title: string; order: number; deleted_at?: number | null; }) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    sets: [{ id: p.id, updated_at: makeUpdatedAt(), updated_by: makeUpdatedBy(p.deviceId), deleted_at: p.deleted_at ?? null, data: { title: p.title, order: p.order } }],
  });
  await pushBatch(payload);
}

export async function upsertChecklistAction(p: { userId: string; deviceId: string; id: string; set_id: string; title: string; order: number; }) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    actions: [{ id: p.id, set_id: p.set_id, updated_at: makeUpdatedAt(), updated_by: makeUpdatedBy(p.deviceId), deleted_at: null, data: { title: p.title, order: p.order } }],
  });
  await pushBatch(payload);
}

export async function deleteChecklistAction(p: { userId: string; deviceId: string; id: string; set_id: string; title?: string; order?: number; }) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    actions: [{ id: p.id, set_id: p.set_id, updated_at: makeUpdatedAt(), updated_by: makeUpdatedBy(p.deviceId), deleted_at: nowMs(), data: { title: p.title, order: p.order } }],
  });
  await pushBatch(payload);
}

/* =====================
 * 行動ログ同期（開始/終了）
 * ===================== */
export async function upsertChecklistActionLogStart(p: { userId: string; deviceId: string; id: string; set_id: string; action_id: string; start_at_ms: number; }) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    action_logs: [{ id: p.id, set_id: p.set_id, action_id: p.action_id, updated_at: makeUpdatedAt(), updated_by: makeUpdatedBy(p.deviceId), deleted_at: null, data: { start_at_ms: p.start_at_ms, end_at_ms: null, duration_ms: null } }],
  });
  await pushBatch(payload);
}

export async function upsertChecklistActionLogEnd(p: { userId: string; deviceId: string; id: string; set_id: string; action_id: string; end_at_ms: number; duration_ms: number; }) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    action_logs: [{ id: p.id, set_id: p.set_id, action_id: p.action_id, updated_at: makeUpdatedAt(), updated_by: makeUpdatedBy(p.deviceId), deleted_at: null, data: { end_at_ms: p.end_at_ms, duration_ms: p.duration_ms } }],
  });
  await pushBatch(payload);
}
