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

export type PullResponse = {
  server_time_ms: number;
  diffs: {
    checklist_sets: ChecklistSetRow[];
    checklist_actions: ChecklistActionRow[];
  };
};

// --- 共通 ---
const nowMs = () => Date.now();
const DEFAULT_TABLES = ["checklist_sets", "checklist_actions"] as const;
export type TableName = (typeof DEFAULT_TABLES)[number];

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
}) {
  const { userId, deviceId, sets = [], actions = [] } = params;
  return {
    user_id: userId,
    device_id: deviceId,
    changes: {
      checklist_sets: sets,
      checklist_actions: actions,
    },
  };
}

function buildTablesParam(tables?: readonly string[] | readonly TableName[]) {
  const list = tables && tables.length ? tables : DEFAULT_TABLES;
  // readonly配列でも join できるので string[] への代入を避ける
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
  return jsonFetch<PullResponse>(`/api/b/api/sync/pull-batch?${qs.toString()}`, {
    cache: "no-store",
  });
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

  // 最初のスケジュール
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

  // SSR を避ける（client component想定だが保険）
  if (typeof window === "undefined") {
    return { stop() {} };
  }

  const qs = new URLSearchParams({
    user_id: userId,
    since: String(getSince() || 0),
    tables: buildTablesParam(tables),
  });
  const url = `/api/b/api/sync/stream-sse?${qs.toString()}`;

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
    // 接続断など（EventSource は自動再接続）
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

/**
 * スマート同期起動：
 * 1) まず SSE を開始（即時反映）
 * 2) 安全のためのフォールバックとしてポーリングも並行または待機
 */
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

// --- Set の upsert/soft-delete ---
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
        updated_at: nowMs(),
        updated_by: p.deviceId,
        deleted_at: p.deleted_at ?? null,
        data: { title: p.title, order: p.order },
      },
    ],
  });
  await jsonFetch(`/api/b/api/sync/push-batch`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// --- Action の upsert/delete ---
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
        updated_at: nowMs(),
        updated_by: p.deviceId,
        deleted_at: null,
        data: { title: p.title, order: p.order },
      },
    ],
  });
  await jsonFetch(`/api/b/api/sync/push-batch`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteChecklistAction(p: {
  userId: string;
  deviceId: string;
  id: string;
  set_id: string;
  title?: string; // サーバ側 upsert 仕様上、残しても良い
  order?: number;
}) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    actions: [
      {
        id: p.id,
        set_id: p.set_id,
        updated_at: nowMs(),
        updated_by: p.deviceId,
        deleted_at: nowMs(),
        data: { title: p.title, order: p.order },
      },
    ],
  });
  await jsonFetch(`/api/b/api/sync/push-batch`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
