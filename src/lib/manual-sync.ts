// frontend/src/lib/manual-sync.ts
// ===================================================
// ✅ Support-AI 手動同期ユーティリティ
// ---------------------------------------------------
// 各機能ページで「registerManualSync({ pull, push, reset })」を
// 呼ぶだけで、ホーム画面の📥取得／☁アップロードに連動する。
// ===================================================

export type ManualSyncHandlers = {
  pull: () => Promise<void> | void;
  push: () => Promise<void> | void;
  reset?: () => Promise<void> | void;
};

const SYNC_CHANNEL = "support-ai-sync";
export const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";

/**
 * 各機能ページから呼び出して手動同期イベントを購読する。
 * @param handlers pull/push/reset 各イベントで呼びたい処理
 * @returns unsubscribe 関数（unmount時に呼び出し）
 */
export function registerManualSync(handlers: ManualSyncHandlers) {
  const { pull, push, reset } = handlers;

  // --- ① BroadcastChannel（ブラウザ間） ---
  let bc: BroadcastChannel | null = null;
  try {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      bc = new BroadcastChannel(SYNC_CHANNEL);
      bc.onmessage = (ev) => {
        const msg = ev?.data;
        if (!msg || typeof msg.type !== "string") return;
        const t = msg.type.toUpperCase();
        if (t.includes("PULL")) pull?.();
        else if (t.includes("PUSH")) push?.();
        else if (t.includes("RESET")) reset?.();
      };
    }
  } catch {
    // noop
  }

  // --- ② 同タブ内の postMessage ---
  const onWinMsg = (ev: MessageEvent) => {
    const msg = ev?.data;
    if (!msg || typeof msg.type !== "string") return;
    const t = msg.type.toUpperCase();
    if (t.includes("PULL")) pull?.();
    else if (t.includes("PUSH")) push?.();
    else if (t.includes("RESET")) reset?.();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("message", onWinMsg);
  }

  // --- ③ 他タブ間（storage イベント） ---
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === STORAGE_KEY_RESET_REQ) {
      reset?.();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  // --- unmount時のクリーンアップ関数 ---
  return () => {
    try {
      bc?.close();
    } catch {}
    if (typeof window !== "undefined") {
      window.removeEventListener("message", onWinMsg);
      window.removeEventListener("storage", onStorage);
    }
  };
}
