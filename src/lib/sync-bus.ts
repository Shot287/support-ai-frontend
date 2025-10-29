// frontend/src/lib/sync-bus.ts
// ===================================================
// 🔔 手動同期イベントバス（受信 Pull / 送信 Push）
//  - ホームの「同期（受信）」→ 全機能へ Pull 合図
//  - ホームの「手動アップロード」→ 全機能へ Push 合図
//  - BroadcastChannel / postMessage / storage の三段冗長
//  - SSR 安全
// ===================================================

export const SYNC_CHANNEL = "support-ai-sync";

// storage イベント用キー
export const STORAGE_KEY_PULL_REQ = "support-ai:sync:pull:req";
export const STORAGE_KEY_PUSH_REQ = "support-ai:sync:push:req";

// イベント種別
export const EVENT_TYPE_PULL = "GLOBAL_SYNC_PULL" as const;
export const EVENT_TYPE_PUSH = "GLOBAL_SYNC_PUSH" as const;

export type GlobalPullPayload = {
  type: typeof EVENT_TYPE_PULL;
  userId: string;
  deviceId: string;
  at: number;     // 送信時刻(ms)
  nonce?: string; // storage 伝搬用一意キー
};

export type GlobalPushPayload = {
  type: typeof EVENT_TYPE_PUSH;
  userId: string;
  deviceId: string;
  at: number;     // 送信時刻(ms)
  nonce?: string; // storage 伝搬用一意キー
};

const isBrowser = () => typeof window !== "undefined";

/* ===================================================
 * emit 系
 * =================================================== */

/** 全機能へ「受信（Pull）してね」合図を送る */
export function emitGlobalPull(userId: string, deviceId: string) {
  if (!isBrowser()) return;

  const payload: GlobalPullPayload = {
    type: EVENT_TYPE_PULL,
    userId,
    deviceId,
    at: Date.now(),
  };

  // 1) BroadcastChannel
  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel(SYNC_CHANNEL);
      bc.postMessage(payload);
      bc.close();
    }
  } catch {}

  // 2) 同タブ
  try {
    window.postMessage(payload, "*");
  } catch {}

  // 3) 他タブ（storage）
  try {
    const withNonce: GlobalPullPayload = { ...payload, nonce: Math.random().toString(36).slice(2) };
    localStorage.setItem(STORAGE_KEY_PULL_REQ, JSON.stringify(withNonce));
  } catch {}
}

/** 全機能へ「手動アップロード（Push）してね」合図を送る */
export function emitGlobalPush(userId: string, deviceId: string) {
  if (!isBrowser()) return;

  const payload: GlobalPushPayload = {
    type: EVENT_TYPE_PUSH,
    userId,
    deviceId,
    at: Date.now(),
  };

  // 1) BroadcastChannel
  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel(SYNC_CHANNEL);
      bc.postMessage(payload);
      bc.close();
    }
  } catch {}

  // 2) 同タブ
  try {
    window.postMessage(payload, "*");
  } catch {}

  // 3) 他タブ（storage）
  try {
    const withNonce: GlobalPushPayload = { ...payload, nonce: Math.random().toString(36).slice(2) };
    localStorage.setItem(STORAGE_KEY_PUSH_REQ, JSON.stringify(withNonce));
  } catch {}
}

/* ===================================================
 * subscribe 系（解除関数を返す）
 * =================================================== */

/** 受信（Pull）合図を購読する */
export function subscribeGlobalPull(handler: (payload: GlobalPullPayload) => void) {
  if (!isBrowser()) return () => {};

  const safeHandle = (maybe: any) => {
    if (maybe && typeof maybe === "object" && maybe.type === EVENT_TYPE_PULL) {
      handler(maybe as GlobalPullPayload);
    }
  };

  // 1) BroadcastChannel
  let bc: BroadcastChannel | undefined;
  try {
    if ("BroadcastChannel" in window) {
      bc = new BroadcastChannel(SYNC_CHANNEL);
      bc.onmessage = (e) => safeHandle(e.data);
    }
  } catch {}

  // 2) 同タブ
  const onMessage = (e: MessageEvent) => safeHandle(e.data);
  window.addEventListener("message", onMessage);

  // 3) 他タブ（storage）
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY_PULL_REQ || !e.newValue) return;
    try {
      safeHandle(JSON.parse(e.newValue));
    } catch {}
  };
  window.addEventListener("storage", onStorage);

  // 解除
  return () => {
    try { bc?.close(); } catch {}
    window.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
  };
}

/** 手動アップロード（Push）合図を購読する */
export function subscribeGlobalPush(handler: (payload: GlobalPushPayload) => void) {
  if (!isBrowser()) return () => {};

  const safeHandle = (maybe: any) => {
    if (maybe && typeof maybe === "object" && maybe.type === EVENT_TYPE_PUSH) {
      handler(maybe as GlobalPushPayload);
    }
  };

  // 1) BroadcastChannel
  let bc: BroadcastChannel | undefined;
  try {
    if ("BroadcastChannel" in window) {
      bc = new BroadcastChannel(SYNC_CHANNEL);
      bc.onmessage = (e) => safeHandle(e.data);
    }
  } catch {}

  // 2) 同タブ
  const onMessage = (e: MessageEvent) => safeHandle(e.data);
  window.addEventListener("message", onMessage);

  // 3) 他タブ（storage）
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY_PUSH_REQ || !e.newValue) return;
    try {
      safeHandle(JSON.parse(e.newValue));
    } catch {}
  };
  window.addEventListener("storage", onStorage);

  // 解除
  return () => {
    try { bc?.close(); } catch {}
    window.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
  };
}
