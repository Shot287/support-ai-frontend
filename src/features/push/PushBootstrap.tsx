'use client';
import { useEffect } from 'react';

/**
 * Push通知初期化フロー（スマホ対応・再入可能・冪等）
 * 1) Service Worker 登録
 * 2) 通知許可リクエスト（必要時のみ）
 * 3) VAPID公開鍵の取得（バックエンド /push/vapid-public-key）
 * 4) PushManager.subscribe() で購読
 * 5) サブスクリプションをバックエンドへ登録（/push/subscribe または /push/register）
 *
 * 環境変数:
 * - NEXT_PUBLIC_BACKEND_ORIGIN: 例) https://support-ai-os6k.onrender.com
 *   （未設定なら上記URLをデフォルトとして使用）
 * - NEXT_PUBLIC_API_TOKEN:     （任意）Render側API_TOKENと合わせる場合に使用
 */
export default function PushBootstrap() {
  useEffect(() => {
    (async () => {
      try {
        if (!('serviceWorker' in navigator)) {
          console.warn('[Push] Service Worker not supported');
          return;
        }

        // ===== 1) Service Worker 登録 =====
        const reg = await navigator.serviceWorker.register('/sw.js');
        console.log('[Push] Service Worker registered:', reg.scope);

        // ===== 2) 通知許可の確認・要求 =====
        // i) すでに拒否なら何もしない（UIで手動変更が必要）
        if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
          console.warn('[Push] Notification permission is denied (OS/Chromeの通知設定を許可にしてください)');
          return;
        }
        // ii) まだ未決なら、ユーザーに許可を求める
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          const perm = await Notification.requestPermission();
          console.log('[Push] Notification.requestPermission:', perm);
          if (perm !== 'granted') {
            console.warn('[Push] User did not grant notifications');
            return;
          }
        }

        // ===== 3) 既存購読があるかチェック =====
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          console.log('[Push] already subscribed:', true, existing.endpoint);
          // 念のためサーバに再登録しておく（端末追加時の同期用）
          await safeRegisterToServer(existing);
          return;
        }

        // ===== 4) VAPID 公開鍵の取得 =====
        const BACKEND = getBackendOrigin();
        const vapidRes = await fetch(`${BACKEND}/push/vapid-public-key`, { method: 'GET' });
        if (!vapidRes.ok) {
          throw new Error(`[Push] failed to fetch VAPID public key: ${vapidRes.status}`);
        }

        // 返却形式に幅を持たせる（text or {key:"..."} or {publicKey:"..."}）
        let vapidKeyBase64: string | undefined;
        const contentType = vapidRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const j = await vapidRes.json().catch(() => ({}));
          vapidKeyBase64 = String(j.key ?? j.publicKey ?? '');
        } else {
          vapidKeyBase64 = (await vapidRes.text()).trim();
        }
        if (!vapidKeyBase64) {
          throw new Error('[Push] VAPID public key is empty');
        }

        // ===== 5) Push購読 =====
        const newSub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKeyBase64),
        });
        console.log('[Push] subscribed:', true, newSub.endpoint);

        // ===== 6) サーバへ登録 =====
        await safeRegisterToServer(newSub);
      } catch (err) {
        console.error('[Push] bootstrap error:', err);
      }
    })();
  }, []);

  return null;
}

/* ================= ユーティリティ ================= */

function getBackendOrigin(): string {
  // 既知の既定値（ユーザー実績あり）：https://support-ai-os6k.onrender.com
  const fallback = 'https://support-ai-os6k.onrender.com';
  const env = (process.env.NEXT_PUBLIC_BACKEND_ORIGIN || '').trim();
  return env || fallback;
}

/**
 * サブスクリプションをバックエンドへ登録。
 * /push/subscribe → 404なら /push/register を試す（両対応）
 * APIトークン（任意）があれば x-token で付与。
 */
async function safeRegisterToServer(sub: PushSubscription): Promise<void> {
  const BACKEND = getBackendOrigin();
  const token = (process.env.NEXT_PUBLIC_API_TOKEN || '').trim();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-token'] = token;

  const body = JSON.stringify(sub); // PushSubscriptionはシリアライズ可能（toJSONも可）

  // 1st: /push/subscribe
  let res = await fetch(`${BACKEND}/push/subscribe`, {
    method: 'POST',
    headers,
    body,
  });

  // 2nd: /push/register（互換エンドポイント）
  if (!res.ok && res.status === 404) {
    res = await fetch(`${BACKEND}/push/register`, {
      method: 'POST',
      headers,
      body,
    });
  }

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`[Push] register failed: ${res.status} ${msg}`);
  }
  console.log('[Push] register done');
}

/** VAPID base64 → Uint8Array 変換 */
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = typeof atob !== 'undefined' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
