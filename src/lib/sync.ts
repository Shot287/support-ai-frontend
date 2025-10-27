// frontend/src/lib/sync.ts

// --- 型 ---
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

// ★ 行動ログ（開始/終了/所要）の同期用
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
    // ★ ログも返す
    checklist_action_logs: ChecklistActionLogRow[];
  };
};

// --- 共通 ---
const nowMs = () => Date.now();
// ★ 既定テーブルに logs を追加
const DEFAULT_TABLES = ["checklist_sets", "checklist_actions", "checklist_action_logs"] as const;
export type TableName = (typeof DEFAULT_TABLES)[number];

// 🔐 固定キー（Render の APP_KEY と同じ値を使用）
const APP_KEY = "Utl3xA429JRn+BdOdiTDPOxU30ppOkMi8NMOkcCzSvo=";
const APP_KEY_Q = `app_key=${encodeURIComponent(APP_KEY)}`;

// --- 端末優先度ユーティリティ（スマホをやや優先） ---
const isMobileDevice = () =>
  typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

const makeUpdatedBy = (deviceId: string) => {
  const prio = isMobileDevice() ? "9" : "5";
  return `${prio}|${deviceId}`;
};

const makeUpdatedAt = () => {
  const t = nowMs();
  return isMobileDevice() ? t + 2 : t;
};

async function jsonFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

function pushBatchPayload(params: {
  userId: string;
  deviceId: string;
  sets?: Array<{
    id: string;
    updated_at: number;
    updated_by: string;
    deleted_at: number | null;
    data: { title?: string; order?: number };
  }>;
  actions?: Array<{
    id: string;
    set_id: string;
    updated_at: number;
    updated_by: string;
    deleted_at: number | null;
    data: { title?: string; order?: number };
  }>;
  // ★ 行動ログも受け付ける
  action_logs?: Array<{
    id: string;
    set_id: string;
    action_id: string;
    updated_at: number;
    updated_by: string;
    deleted_at: number | null;
    data: { start_at_ms?: number | null; end_at_ms?: number | null; duration_ms?: number | null };
  }>;
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

function buildTablesParam(tables?: readonly string[] | readonly TableName[]) {
  const list = tables && tables.length ? tables : DEFAULT_TABLES;
  return Array.from(list).join(",");
}

// --- Pull（差分取得） ---
export async function pullBatch(
  userId: string,
  since: number,
  tables: readonly string[] | readonly TableName[] = DEFAULT_TABLES
) {
  const qs = new URLSearchParams({
    user_id: userId,
    since: String(since || 0),
    tables: buildTablesParam(tables),
  });
  const url = `/api/b/api/sync/pull-batch?${qs.toString()}&${APP_KEY_Q}`;
  return jsonFetch<PullResponse>(url, { cache: "no-store" });
}

// --- ポーリング開始 ---
export function startChecklistPolling(opts: {
  userId: string;
  deviceId: string; // 互換のため保持（未使用）
  getSince: () => number;
  setSince: (ms: number) => void;
  applyDiffs: (diffs: PullResponse["diffs"]) => void;
  intervalMs?: number;
  tables?: readonly string[] | readonly TableName[];
  abortSignal?: AbortSignal;
}) {
  const {
    userId,
    getSince,
    setSince,
    applyDiffs,
    intervalMs = 15000,
    tables = DEFAULT_TABLES,
    abortSignal,
  } = opts;

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

  abortSignal?.addEventListener("abort", () => {
    if (timer) clearTimeout(timer);
  });

  return {
    stop() {
      if (timer) clearTimeout(timer);
    },
  };
}

// --- SSE（即時反映） ---
export function startRealtimeSync(opts: {
  userId: string;
  getSince: () => number;
  setSince: (ms: number) => void;
  applyDiffs: (diffs: PullResponse["diffs"]) => void;
  tables?: readonly string[] | readonly TableName[];
  abortSignal?: AbortSignal;
}) {
  const {
    userId,
    getSince,
    setSince,
    applyDiffs,
    tables = DEFAULT_TABLES,
    abortSignal,
  } = opts;

  if (typeof window === "undefined") {
    return { stop() {} };
  }

  const qs = new URLSearchParams({
    user_id: userId,
    since: String(getSince() || 0),
    tables: buildTablesParam(tables),
  });
  const url = `/api/b/api/sync/stream-sse?${qs.toString()}&${APP_KEY_Q}`;

  const es = new EventSource(url, { withCredentials: false });

  const onMessage = (ev: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(ev.data) as PullResponse;
      applyDiffs(payload.diffs);
      setSince(payload.server_time_ms);
    } catch (e) {
      console.warn("[sync] SSE message parse failed:", e);
    }
  };

  const onError = (ev: any) => {
    console.warn("[sync] SSE error:", ev);
  };

  es.addEventListener("message", onMessage);
  es.addEventListener("error", onError);

  const stop = () => {
    es.removeEventListener("message", onMessage as any);
    es.removeEventListener("error", onError as any);
    es.close();
  };

  abortSignal?.addEventListener("abort", stop);

  return { stop };
}

// --- スマート同期 ---
export function startSmartSync(opts: {
  userId: string;
  deviceId: string; // API互換で受け取るが SSE では未使用
  getSince: () => number;
  setSince: (ms: number) => void;
  applyDiffs: (diffs: PullResponse["diffs"]) => void;
  tables?: readonly string[] | readonly TableName[];
  fallbackPolling?: boolean;
  pollingIntervalMs?: number;
  abortSignal?: AbortSignal;
}) {
  const {
    userId,
    deviceId,
    getSince,
    setSince,
    applyDiffs,
    tables = DEFAULT_TABLES,
    fallbackPolling = true,
    pollingIntervalMs = 30000,
    abortSignal,
  } = opts;

  const sseCtl = startRealtimeSync({
    userId,
    getSince,
    setSince,
    applyDiffs,
    tables,
    abortSignal,
  });

  let pollCtl: { stop: () => void } | undefined;

  if (fallbackPolling) {
    pollCtl = startChecklistPolling({
      userId,
      deviceId,
      getSince,
      setSince,
      applyDiffs,
      tables,
      intervalMs: pollingIntervalMs,
      abortSignal,
    });
  }

  return {
    stop() {
      sseCtl.stop();
      pollCtl?.stop();
    },
  };
}

// --- upsert/delete（セット・行動） ---
export async function upsertChecklistSet(p: {
  userId: string;
  deviceId: string;
  id: string;
  title: string;
  order: number;
  deleted_at?: number | null;
}) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    sets: [
      {
        id: p.id,
        updated_at: makeUpdatedAt(),
        updated_by: makeUpdatedBy(p.deviceId),
        deleted_at: p.deleted_at ?? null,
        data: { title: p.title, order: p.order },
      },
    ],
  });
  await jsonFetch(`/api/b/api/sync/push-batch?${APP_KEY_Q}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function upsertChecklistAction(p: {
  userId: string;
  deviceId: string;
  id: string;
  set_id: string;
  title: string;
  order: number;
}) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    actions: [
      {
        id: p.id,
        set_id: p.set_id,
        updated_at: makeUpdatedAt(),
        updated_by: makeUpdatedBy(p.deviceId),
        deleted_at: null,
        data: { title: p.title, order: p.order },
      },
    ],
  });
  await jsonFetch(`/api/b/api/sync/push-batch?${APP_KEY_Q}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteChecklistAction(p: {
  userId: string;
  deviceId: string;
  id: string;
  set_id: string;
  title?: string;
  order?: number;
}) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    actions: [
      {
        id: p.id,
        set_id: p.set_id,
        updated_at: makeUpdatedAt(),
        updated_by: makeUpdatedBy(p.deviceId),
        deleted_at: nowMs(),
        data: { title: p.title, order: p.order },
      },
    ],
  });
  await jsonFetch(`/api/b/api/sync/push-batch?${APP_KEY_Q}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// --- upsert（行動ログ：開始/終了） ---
// 1. 行動開始：ログ1件を作成 or 更新（start_at_ms を保持、終了は未定義）
export async function upsertChecklistActionLogStart(p: {
  userId: string;
  deviceId: string;
  id: string;          // 行動ログID（フロントで生成して同じIDを end にも使う）
  set_id: string;
  action_id: string;
  start_at_ms: number; // 開始UNIX ms
}) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    action_logs: [
      {
        id: p.id,
        set_id: p.set_id,
        action_id: p.action_id,
        updated_at: makeUpdatedAt(),
        updated_by: makeUpdatedBy(p.deviceId),
        deleted_at: null,
        data: {
          start_at_ms: p.start_at_ms,
          end_at_ms: null,
          duration_ms: null,
        },
      },
    ],
  });
  await jsonFetch(`/api/b/api/sync/push-batch?${APP_KEY_Q}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// 2. 行動終了：同じログIDに end_at_ms / duration_ms を書き込む
export async function upsertChecklistActionLogEnd(p: {
  userId: string;
  deviceId: string;
  id: string;           // start と同じログID
  set_id: string;
  action_id: string;
  end_at_ms: number;    // 終了UNIX ms
  duration_ms: number;  // 所要ミリ秒
}) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    action_logs: [
      {
        id: p.id,
        set_id: p.set_id,
        action_id: p.action_id,
        updated_at: makeUpdatedAt(),
        updated_by: makeUpdatedBy(p.deviceId),
        deleted_at: null,
        data: {
          // start_at_ms は既存値が勝つので送らなくてもOKだが、明示したい場合は undefined にしない
          end_at_ms: p.end_at_ms,
          duration_ms: p.duration_ms,
        },
      },
    ],
  });
  await jsonFetch(`/api/b/api/sync/push-batch?${APP_KEY_Q}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ===============================
// 手動「この端末を正にする」同期
// ===============================
const MASTER_BOOST_MS = 5000;
const makeMasterUpdatedAt = () => nowMs() + MASTER_BOOST_MS;
const makeMasterUpdatedBy = (deviceId: string) => `Z|${deviceId}`;

// ローカルスナップショット型（チェックリスト）
type LocalSet = {
  id: string;
  title?: string;
  order?: number;
  deleted_at?: number | null;
};
type LocalAction = {
  id: string;
  set_id: string;
  title?: string;
  order?: number;
  deleted_at?: number | null;
  is_done?: boolean;
};

// --- チェックリスト専用（既存修正：actions は sets 配下から展開） ---
function buildChecklistChangesFromLocal(userId: string, deviceId: string) {
  if (typeof window === "undefined") {
    return { checklist_sets: [] as any[], checklist_actions: [] as any[] /*, checklist_action_logs: [] as any[]*/ };
  }

  let snap: any = null;
  try {
    snap = JSON.parse(localStorage.getItem("checklist_v1") ?? "null");
  } catch {
    snap = null;
  }

  const setsArr: any[] = Array.isArray(snap?.sets) ? snap.sets : [];

  // sets
  const upBy = makeMasterUpdatedBy(deviceId);
  const upAt = makeMasterUpdatedAt();

  const checklist_sets = setsArr.map((s: any, i: number) => ({
    id: String(s.id),
    updated_at: upAt,
    updated_by: upBy,
    deleted_at: s?.deleted_at ?? null,
    data: {
      title: String(s?.title ?? ""),
      order: Number(s?.order ?? i ?? 0),
    },
  }));

  // actions（各set配下から平坦化）
  const checklist_actions: any[] = [];
  for (const s of setsArr) {
    const acts: any[] = Array.isArray(s?.actions) ? s.actions : [];
    acts.forEach((a, idx) => {
      checklist_actions.push({
        id: String(a.id),
        set_id: String(s.id),
        updated_at: upAt,
        updated_by: upBy,
        deleted_at: a?.deleted_at ?? null,
        data: {
          title: String(a?.title ?? ""),
          order: Number(a?.order ?? idx ?? 0),
          // is_done を同期したくなったら以下を有効化
          // is_done: !!a?.isDone,
        },
      });
    });
  }

  // ★ ログはローカルにIDを持っていないため、マスター同期では送らない
  return { checklist_sets, checklist_actions /*, checklist_action_logs: []*/ };
}

export async function forceSyncAsMaster(opts: {
  userId: string;
  deviceId: string;
  tables?: readonly string[] | readonly TableName[];
  getSince: () => number;
  setSince: (ms: number) => void;
  applyDiffs: (diffs: PullResponse["diffs"]) => void;
}) {
  const { userId, deviceId, tables = DEFAULT_TABLES, getSince, setSince, applyDiffs } = opts;
  const changes = buildChecklistChangesFromLocal(userId, deviceId);
  const payload = { user_id: userId, device_id: deviceId, changes };
  await jsonFetch(`/api/b/api/sync/push-batch?${APP_KEY_Q}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const resp = await pullBatch(userId, getSince(), tables);
  applyDiffs(resp.diffs);
  setSince(resp.server_time_ms);
}

// ===============================
// 全機能用（ホームボタン）
// ===============================
function mergeChanges(...bundles: Array<Record<string, any[]>>) {
  const out: Record<string, any[]> = {};
  for (const b of bundles) {
    for (const [k, v] of Object.entries(b)) {
      out[k] = (out[k] ?? []).concat(v as any[]);
    }
  }
  return out;
}

/** 全機能をこの端末で同期（ホームボタン用） */
export async function forceSyncAllMaster(opts: {
  userId: string;
  deviceId: string;
}) {
  const { userId, deviceId } = opts;
  const checklist = buildChecklistChangesFromLocal(userId, deviceId);
  const changes = mergeChanges(checklist); // 現状はチェックリストのみ

  const payload = { user_id: userId, device_id: deviceId, changes };
  await jsonFetch(`/api/b/api/sync/push-batch?${APP_KEY_Q}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  console.info("[sync] 全機能をこの端末の内容で同期しました");
}
