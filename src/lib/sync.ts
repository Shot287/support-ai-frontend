// frontend/src/lib/sync.ts
// 最小構成：checklist のリアルタイム同期（ポーリング）クライアント
// - バックエンドの /api/sync/pull-batch / push-batch を叩く
// - /api/b/[...path] 経由でバックエンドへプロキシ（x-app-key はプロキシ側で付与される想定）

export type Ms = number;

export type ChecklistSetRow = {
  id: string;
  user_id: string;
  title: string;
  order: number;
  updated_at: Ms;
  updated_by: string;
  deleted_at: Ms | null;
};

export type ChecklistActionRow = {
  id: string;
  user_id: string;
  set_id: string;
  label: string;
  done: boolean;
  order: number;
  updated_at: Ms;
  updated_by: string;
  deleted_at: Ms | null;
};

// pull のレスポンス
export type PullResponse = {
  server_time_ms: Ms;
  diffs: {
    checklist_sets: ChecklistSetRow[];
    checklist_actions: ChecklistActionRow[];
  };
};

// push のペイロード
export type ChangeSet = {
  checklist_sets: Array<{
    id: string;
    updated_at: Ms;
    updated_by: string;
    deleted_at: Ms | null;
    data: Partial<Pick<ChecklistSetRow, "title" | "order">>;
  }>;
  checklist_actions: Array<{
    id: string;
    updated_at: Ms;
    updated_by: string;
    deleted_at: Ms | null;
    data: Partial<Pick<ChecklistActionRow, "set_id" | "label" | "done" | "order">>;
  }>;
};

const B = "/api/b"; // Next のバックエンドプロキシ（既存: src/app/api/b/[...path]/route.ts）

/** サーバから since 以降の差分を取得 */
export async function pullSince(userId: string, since: Ms, tables?: string[]): Promise<PullResponse> {
  const qs = new URLSearchParams({
    user_id: userId,
    since: String(since),
  });
  if (tables?.length) qs.set("tables", tables.join(","));
  const res = await fetch(`${B}/api/sync/pull-batch?${qs.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`pull-batch failed: ${res.status}`);
  }
  return res.json();
}

/** ローカル変更をまとめてサーバへ反映 */
export async function pushBatch(userId: string, deviceId: string, changes: ChangeSet): Promise<void> {
  const res = await fetch(`${B}/api/sync/push-batch`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      user_id: userId,
      device_id: deviceId,
      changes,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`push-batch failed: ${res.status} ${body}`);
  }
}

/**
 * ポーリング同期の最小ユーティリティ
 * - ローカルの applyDiffs を呼び出してUIに反映
 * - 失敗しても次回に再挑戦（指数バックオフ簡易版）
 */
export async function startChecklistPolling(params: {
  userId: string;
  deviceId: string;
  getSince: () => Ms;                 // 直近 pull の server_time_ms を返す getter（未pull は 0）
  setSince: (ms: Ms) => void;         // 最新 server_time_ms を保存する setter
  applyDiffs: (diffs: PullResponse["diffs"]) => void; // 取得した差分をローカル状態へ反映
  intervalMs?: number;                // 既定 15000ms
  abortSignal?: AbortSignal;          // ページ離脱で止める用
}): Promise<void> {
  const {
    userId,
    getSince,
    setSince,
    applyDiffs,
    intervalMs = 15000,
    abortSignal,
  } = params;

  let delay = intervalMs;
  while (!abortSignal?.aborted) {
    try {
      const since = getSince() ?? 0;
      const res = await pullSince(userId, since, ["checklist_sets", "checklist_actions"]);
      // 差分を適用
      applyDiffs(res.diffs);
      // since を前進
      setSince(res.server_time_ms);
      // 正常時は既定間隔
      delay = intervalMs;
    } catch (e) {
      console.error("[sync] pull failed:", e);
      // 失敗時は簡易バックオフ（最大60秒）
      delay = Math.min(Math.round((delay || intervalMs) * 1.8), 60000);
    }
    // 待機（中断可能）
    await new Promise<void>((ok) => {
      const t = setTimeout(() => ok(), delay);
      abortSignal?.addEventListener("abort", () => {
        clearTimeout(t);
        ok();
      }, { once: true });
    });
  }
}

/**
 * 変更1件を push するヘルパ（ChecklistSet の例）
 * - 楽に使えるよう最小引数だけ
 */
export async function upsertChecklistSet(args: {
  userId: string; deviceId: string;
  id: string; title: string; order: number;
  deleted_at?: Ms | null;
}) {
  const now = Date.now();
  await pushBatch(args.userId, args.deviceId, {
    checklist_sets: [{
      id: args.id,
      updated_at: now,
      updated_by: args.deviceId,
      deleted_at: args.deleted_at ?? null,
      data: { title: args.title, order: args.order },
    }],
    checklist_actions: [],
  });
}
