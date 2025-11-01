// frontend/src/lib/sync.ts
// ===================================================
// ✅ Support-AI 同期ライブラリ（ジェネリック対応 + 既存互換）
//    - 既存APIは後方互換を維持（checklist / dictionary）
//    - 新規: useSync(tableName), pushGeneric(table, rows)
//    - 粘着フラグ & 受信合図は push 成功時に自動実行
//    - SSE + フォールバック・ポーリング（互換維持）
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
  is_done?: boolean;
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

export type DictionaryEntryRow = {
  id: string;
  user_id: string;
  term: string | null;
  yomi: string | null;
  meaning: string | null;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
};

export type PullResponse = {
  server_time_ms: number;
  diffs: {
    checklist_sets?: ChecklistSetRow[];
    checklist_actions?: ChecklistActionRow[];
    checklist_action_logs?: ChecklistActionLogRow[];
    dictionary_entries?: DictionaryEntryRow[];
    [k: string]: unknown;
  };
};

/** サーバに渡す Generic ChangeRow（backend の pydantic に合わせた形） */
export type GenericChangeRow = {
  id: string;
  updated_at?: number;
  updated_by?: string;
  deleted_at?: number | null;
  /** 固定外部キー（あれば記入: set_id, action_id など） */
  [fixed: `${string}_id`]: any;
} & {
  data?: Record<string, any>;
};

/* =====================
 * 定数・共通設定
 * ===================== */
const RAW_BACKEND = process.env.NEXT_PUBLIC_BACKEND!;
const APP_KEY = process.env.NEXT_PUBLIC_APP_KEY!;
if (!RAW_BACKEND) throw new Error("NEXT_PUBLIC_BACKEND is not set");
if (!APP_KEY) throw new Error("NEXT_PUBLIC_APP_KEY is not set");

// 末尾スラッシュを除去して2重 // を避ける
const BACKEND = RAW_BACKEND.replace(/\/+$/, "");
const nowMs = () => Date.now();

/** 既定の pull 対象（辞書を含む） */
export const DEFAULT_TABLES = [
  "checklist_sets",
  "checklist_actions",
  "checklist_action_logs",
  "dictionary_entries",
] as const;
export type TableName = (typeof DEFAULT_TABLES)[number] | string;

const isMobileDevice = () =>
  typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

const makeUpdatedBy = (deviceId: string) => `${isMobileDevice() ? "9" : "5"}|${deviceId}`;
const makeUpdatedAt = () => (isMobileDevice() ? nowMs() + 2 : nowMs());

/* =====================
 * 粘着フラグ & 合図（Broadcast / storage）ユーティリティ
 * ===================== */
export const STICKY_KEY = "support-ai:sync:pull:sticky";
export const PULL_REQ_KEY = "support-ai:sync:pull:req";
export const RESET_REQ_KEY = "support-ai:sync:reset:req";

/** 保存直後などに “他タブ・他ページも受信してね” と合図する */
export function signalGlobalPull() {
  try {
    // 同タブ
    if (typeof window !== "undefined") {
      window.postMessage({ type: "GLOBAL_SYNC_PULL" }, window.location.origin);
    }
    // 他タブ（storage 経由）
    const payload = JSON.stringify({ type: "GLOBAL_SYNC_PULL" });
    localStorage.setItem(PULL_REQ_KEY, payload);
    // 値が変わらないと発火しない環境向けにクリア
    localStorage.removeItem(PULL_REQ_KEY);
  } catch {}
}

/** 直近に保存があった“痕跡”を残す（フォーカス復帰時の自動PULLに使う） */
export function markStickyPull(now: number = Date.now()) {
  try {
    localStorage.setItem(STICKY_KEY, String(now));
  } catch {}
}

/* =====================
 * 共通 fetch ラッパー（詳細エラー付）
 * ===================== */
async function parseMaybeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiGet<T = any>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BACKEND}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "x-app-key": APP_KEY,
      accept: "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await parseMaybeJson(res);
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText} :: ${JSON.stringify(body)}`);
  }
  return res.json();
}

export async function apiPost<T = any>(path: string, body: any, init?: RequestInit): Promise<T> {
  const url = `${BACKEND}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "x-app-key": APP_KEY,
      "content-type": "application/json",
      accept: "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!res.ok) {
    const resBody = await parseMaybeJson(res);
    throw new Error(`POST ${path} failed: ${res.status} ${res.statusText} :: ${JSON.stringify(resBody)}`);
  }
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
  sets?: Array<{
    id: string;
    updated_at?: number;
    updated_by?: string;
    deleted_at?: number | null;
    data?: { title?: string; order?: number };
  }>;
  actions?: Array<{
    id: string;
    set_id: string;
    updated_at?: number;
    updated_by?: string;
    deleted_at?: number | null;
    data?: { title?: string; order?: number; is_done?: boolean };
  }>;
  action_logs?: Array<{
    id: string;
    set_id: string;
    action_id: string;
    updated_at?: number;
    updated_by?: string;
    deleted_at?: number | null;
    data?: { start_at_ms?: number | null; end_at_ms?: number | null; duration_ms?: number | null };
  }>;
  dictionary_entries?: Array<{
    id: string;
    updated_at?: number;
    updated_by?: string;
    deleted_at?: number | null;
    data?: { term?: string; yomi?: string; meaning?: string };
  }>;
}) {
  const {
    userId,
    deviceId, // 互換のため受け取り続ける（サーバで updated_by を見分ける）
    sets = [],
    actions = [],
    action_logs = [],
    dictionary_entries = [],
  } = params;
  return {
    user_id: userId,
    device_id: deviceId,
    changes: {
      checklist_sets: sets,
      checklist_actions: actions,
      checklist_action_logs: action_logs,
      dictionary_entries,
    },
  };
}

export async function pushBatch(body: any) {
  const res = await apiPost(`/api/sync/push-batch`, body);
  // 粘着フラグ＆合図を自動発火
  markStickyPull();
  signalGlobalPull();
  return res;
}

/* =====================
 * ポーリング（互換維持）
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
  abortSignal?.addEventListener("abort", () => timer && clearTimeout(timer));

  return { stop() { if (timer) clearTimeout(timer); } };
}

/* =====================
 * SSE（リアルタイム同期｜互換維持）
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
    app_key: APP_KEY, // SSEはヘッダ不可なのでURLに付与
  });
  const url = `${BACKEND}/api/sync/stream-sse?${qs.toString()}`;
  const es = new EventSource(url, { withCredentials: false });

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
 * スマート同期（SSE+Fallback｜互換維持）
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
 * Upsert/Delete API（チェックリスト）
 * ===================== */
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
    sets: [{
      id: p.id,
      updated_at: makeUpdatedAt(),
      updated_by: makeUpdatedBy(p.deviceId),
      deleted_at: p.deleted_at ?? null,
      data: { title: p.title, order: p.order },
    }],
  });
  await pushBatch(payload);
}

export async function upsertChecklistAction(p: {
  userId: string;
  deviceId: string;
  id: string;
  set_id: string;
  title: string;
  order: number;
  is_done?: boolean;
}) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    actions: [{
      id: p.id,
      set_id: p.set_id,
      updated_at: makeUpdatedAt(),
      updated_by: makeUpdatedBy(p.deviceId),
      deleted_at: null,
      data: {
        title: p.title,
        order: p.order,
        ...(typeof p.is_done === "boolean" ? { is_done: p.is_done } : {}),
      },
    }],
  });
  await pushBatch(payload);
}

export async function deleteChecklistAction(p: {
  userId: string;
  deviceId: string;
  id: string;
  set_id: string;
  title?: string;
  order?: number;
  is_done?: boolean;
}) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    actions: [{
      id: p.id,
      set_id: p.set_id,
      updated_at: makeUpdatedAt(),
      updated_by: makeUpdatedBy(p.deviceId),
      deleted_at: nowMs(),
      data: {
        title: p.title,
        order: p.order,
        ...(typeof p.is_done === "boolean" ? { is_done: p.is_done } : {}),
      },
    }],
  });
  await pushBatch(payload);
}

/* =====================
 * 行動ログ同期（開始/終了）
 * ===================== */
export async function upsertChecklistActionLogStart(p: {
  userId: string;
  deviceId: string;
  id: string;
  set_id: string;
  action_id: string;
  start_at_ms: number;
}) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    action_logs: [{
      id: p.id,
      set_id: p.set_id,
      action_id: p.action_id,
      updated_at: makeUpdatedAt(),
      updated_by: makeUpdatedBy(p.deviceId),
      deleted_at: null,
      data: { start_at_ms: p.start_at_ms, end_at_ms: null, duration_ms: null },
    }],
  });
  await pushBatch(payload);
}

export async function upsertChecklistActionLogEnd(p: {
  userId: string;
  deviceId: string;
  id: string;
  set_id: string;
  action_id: string;
  end_at_ms: number;
  duration_ms: number;
}) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    action_logs: [{
      id: p.id,
      set_id: p.set_id,
      action_id: p.action_id,
      updated_at: makeUpdatedAt(),
      updated_by: makeUpdatedBy(p.deviceId),
      deleted_at: null,
      data: { end_at_ms: p.end_at_ms, duration_ms: p.duration_ms },
    }],
  });
  await pushBatch(payload);
}

/* =====================
 * 用語辞典 Upsert/Delete
 * ===================== */
export async function upsertDictionaryEntry(p: {
  userId: string;
  deviceId: string;
  id: string;
  term?: string;
  yomi?: string;
  meaning?: string;
  deleted_at?: number | null;
}) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    dictionary_entries: [{
      id: p.id,
      updated_at: makeUpdatedAt(),
      updated_by: makeUpdatedBy(p.deviceId),
      deleted_at: p.deleted_at ?? null,
      data: { term: p.term, yomi: p.yomi, meaning: p.meaning },
    }],
  });
  await pushBatch(payload);
}

export async function deleteDictionaryEntry(p: {
  userId: string;
  deviceId: string;
  id: string;
}) {
  const payload = pushBatchPayload({
    userId: p.userId,
    deviceId: p.deviceId,
    dictionary_entries: [{
      id: p.id,
      updated_at: makeUpdatedAt(),
      updated_by: makeUpdatedBy(p.deviceId),
      deleted_at: nowMs(),
      data: {},
    }],
  });
  await pushBatch(payload);
}

/* =====================
 * 後方互換シム
 * ===================== */
export async function forceSyncAllMaster(_opts: { userId: string; deviceId: string }) {
  return;
}

export async function forceSyncAsMaster(opts: {
  userId: string;
  deviceId: string;
  getSince: () => number;
  setSince: (ms: number) => void;
  applyDiffs: (diffs: PullResponse["diffs"]) => void;
  tables?: readonly TableName[];
}) {
  const resp = await pullBatch(opts.userId, opts.getSince(), opts.tables ?? DEFAULT_TABLES);
  opts.applyDiffs(resp.diffs);
  opts.setSince(resp.server_time_ms);
}

/* ===================================================
 * ★ 新規：汎用 push / 汎用 Hook
 * =================================================== */

/** 汎用 push（任意テーブル） */
export async function pushGeneric(p: {
  table: string;
  userId: string;
  deviceId: string;
  rows: GenericChangeRow[]; // {id, data, *_id?, deleted_at?}
}) {
  const { table, userId, deviceId, rows } = p;
  // updated_at / updated_by を自動補完
  const cooked = rows.map((r) => ({
    ...r,
    updated_at: r.updated_at ?? makeUpdatedAt(),
    updated_by: r.updated_by ?? makeUpdatedBy(deviceId),
  }));
  const body = {
    user_id: userId,
    device_id: deviceId,
    changes: { [table]: cooked },
  };
  const res = await pushBatch(body); // pushBatch 内で粘着フラグ/合図を自動実行
  return res;
}

/** ローカルストレージキー */
function sinceKey(userId: string, table: string) {
  return `support-ai:sync:since:${userId}:${table}`;
}

/** 既存 applyDiffs と互換の “単一テーブル向け” 抽出 */
export function pickTableDiffs<T = any>(diffs: PullResponse["diffs"], table: string): T[] {
  const v = (diffs as any)[table];
  return Array.isArray(v) ? (v as T[]) : [];
}

/** ⭐ 汎用 Hook：useSync(tableName) — SSE + Fallback + 手動 pull/push */
export function useSync(table: string) {
  if (typeof window === "undefined") {
    // SSR セーフティ（ダミー）
    return {
      start() { return { stop() {} }; },
      stop() {},
      getSince() { return 0; },
      setSince(_ms: number) {},
      pullNow: async (_p: { userId: string }) => ({ server_time_ms: 0, diffs: {} as PullResponse["diffs"] }),
      pushRows: async (_p: { userId: string; deviceId: string; rows: GenericChangeRow[] }) => {},
    };
  }

  let ctrl: { stop: () => void } | null = null;

  function getSince(userId: string) {
    const raw = localStorage.getItem(sinceKey(userId, table));
    return raw ? Number(raw) : 0;
    }

  function setSince(userId: string, ms: number) {
    localStorage.setItem(sinceKey(userId, table), String(ms));
  }

  /** 単発 pull（単一テーブルのみ） */
  async function pullNow(p: {
    userId: string;
    tables?: readonly TableName[];
  }) {
    const since = getSince(p.userId);
    const resp = await pullBatch(p.userId, since, p.tables ?? [table]);
    // 呼び出し側が applyTableDiffs で適用する運用
    setSince(p.userId, resp.server_time_ms);
    return resp;
  }

  /** 汎用 pushRows（単一テーブル） */
  async function pushRows(p: { userId: string; deviceId: string; rows: GenericChangeRow[] }) {
    await pushGeneric({ table, userId: p.userId, deviceId: p.deviceId, rows: p.rows });
    // pushBatch 内で markStickyPull/signalGlobalPull 済み
  }

  /** SSE + Fallback を開始（呼び出し側が applyDiffs を渡す） */
  function start(p: {
    userId: string;
    deviceId: string;
    applyDiffs: (rows: any[]) => void; // テーブル単位の配列を受け取る
    fallbackPolling?: boolean;
    pollingIntervalMs?: number;
    abortSignal?: AbortSignal;
  }) {
    const getSinceFn = () => getSince(p.userId);
    const setSinceFn = (ms: number) => setSince(p.userId, ms);

    ctrl = startSmartSync({
      userId: p.userId,
      deviceId: p.deviceId,
      getSince: getSinceFn,
      setSince: setSinceFn,
      tables: [table],
      fallbackPolling: p.fallbackPolling ?? true,
      pollingIntervalMs: p.pollingIntervalMs ?? 30000,
      abortSignal: p.abortSignal,
      applyDiffs: (diffs) => {
        const rows = pickTableDiffs(diffs, table);
        if (rows && rows.length) p.applyDiffs(rows);
      },
    });

    return { stop() { ctrl?.stop(); } };
  }

  function stop() { ctrl?.stop(); ctrl = null; }

  return { start, stop, getSince: (uid: string) => getSince(uid), setSince: (uid: string, ms: number) => setSince(uid, ms), pullNow, pushRows };
}
