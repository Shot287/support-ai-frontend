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

// --- Pull（差分取得） ---
export async function pullBatch(userId: string, since: number, tables: string[] = ["checklist_sets","checklist_actions"]) {
  const qs = new URLSearchParams({
    user_id: userId,
    since: String(since || 0),
    tables: tables.join(","),
  });
  return jsonFetch<PullResponse>(`/api/b/api/sync/pull-batch?${qs.toString()}`, { cache: "no-store" });
}

// --- ポーリング開始 ---
export function startChecklistPolling(opts: {
  userId: string;
  deviceId: string;
  getSince: () => number;
  setSince: (ms: number) => void;
  applyDiffs: (diffs: PullResponse["diffs"]) => void;
  intervalMs?: number;
  abortSignal?: AbortSignal;
}) {
  const {
    userId, getSince, setSince, applyDiffs,
    intervalMs = 15000, abortSignal,
  } = opts;

  let timer: any;

  async function tick() {
    try {
      const resp = await pullBatch(userId, getSince());
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
  title?: string; // サーバ側の upsert 仕様上、残しても良い
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
