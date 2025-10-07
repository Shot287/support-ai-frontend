'use client';
import { useEffect } from 'react';

/**
 * Push通知 初期化（スマホ/スタンドアロン対応・冪等・詳細ログ付き）
 */
export default function PushBootstrap() {
  useEffect(() => {
    let aborted = false;

    const run = async () => {
      try {
        if (document.visibilityState !== 'visible') {
          await waitForVisible();
        }
        if (aborted) return;

        if (!('serviceWorker' in navigator)) {
          console.warn('[Push] Service Worker not supported');
          return;
        }

        // 1) SW登録 → ready
        const reg = await navigator.serviceWorker.register('/sw.js').catch((e: unknown) => {
          console.error('[Push] SW register failed:', errorToString(e));
          throw e;
        });
        console.log('[Push] SW registered. scope =', reg.scope);

        const ready = await navigator.serviceWorker.ready;
        console.log('[Push] SW ready. scope =', ready.scope);

        // 2) 通知許可
        if (typeof Notification === 'undefined') {
          console.warn('[Push] Notification API not available');
          return;
        }
        if (Notification.permission === 'denied') {
          console.warn('[Push] Notification permission is DENIED (端末の通知設定で許可にしてください)');
          return;
        }
        if (Notification.permission === 'default') {
          const perm = await Notification.requestPermission();
          console.log('[Push] requestPermission result =', perm);
          if (perm !== 'granted') {
            console.warn('[Push] User did not grant notifications');
            return;
          }
        }
        if (aborted) return;

        // 3) 既存購読チェック
        let sub = await ready.pushManager.getSubscription();
        if (sub) {
          console.log('[Push] already subscribed:', sub.endpoint);
          await safeRegisterToServer(sub);
          return;
        }

        // 4) VAPID鍵の取得（env → backend の順）
        const vapid =
          (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim() ||
          (await fetchVapidFromBackend());
        if (!vapid) {
          console.error('[Push] VAPID public key is empty');
          return;
        }

        // 5) 購読（ArrayBuffer を明示確保 → Uint8Array にして渡す）
        const key: BufferSource = urlBase64ToUint8ArrayStrict(vapid); // ← 型が BufferSource
        try {
          sub = await ready.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          });
          console.log('[Push] subscribed:', sub.endpoint);
        } catch (err: unknown) {
          const msg = errorToString(err);
          if (msg.includes('NotAllowedError')) {
            console.error('[Push] NotAllowedError: 許可が拒否されています（ブラウザ/OS側でブロック）');
            return;
          }
          if (msg.toLowerCase().includes('applicationserverkey')) {
            console.error('[Push] applicationServerKey invalid: VAPID公開鍵に誤りの可能性');
            return;
          }
          console.error('[Push] subscribe failed once, retrying after ready re-check:', msg);
          const ready2 = await navigator.serviceWorker.ready;
          sub = await ready2.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          });
          console.log('[Push] subscribed (retry):', sub.endpoint);
        }

        if (!sub) return;

        // 6) サーバへ登録
        await safeRegisterToServer(sub);
      } catch (e: unknown) {
        console.error('[Push] bootstrap error:', errorToString(e));
      }
    };

    run();
    return () => {
      aborted = true;
    };
  }, []);

  return null;
}

/* ================ ユーティリティ ================ */

function getBackendOrigin(): string {
  const fallback = 'https://support-ai-os6k.onrender.com';
  const env = (process.env.NEXT_PUBLIC_BACKEND_ORIGIN || '').trim();
  return env || fallback;
}

type VapidJson = { key?: unknown; publicKey?: unknown };

async function fetchVapidFromBackend(): Promise<string> {
  const BACKEND = getBackendOrigin();
  try {
    const res = await fetch(`${BACKEND}/push/vapid-public-key`, { method: 'GET' });
    if (!res.ok) {
      console.error('[Push] failed to fetch VAPID:', res.status);
      return '';
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = (await res.json()) as VapidJson;
      const raw =
        (typeof j.key === 'string' ? j.key : typeof j.publicKey === 'string' ? j.publicKey : '') || '';
      return raw.trim();
    }
    const t = (await res.text()).trim();
    return t;
  } catch (e: unknown) {
    console.error('[Push] fetchVapidFromBackend error:', errorToString(e));
    return '';
  }
}

/** サブスクリプションをバックエンドへ登録（/push/subscribe → /push/register） */
async function safeRegisterToServer(sub: PushSubscription): Promise<void> {
  const BACKEND = getBackendOrigin();
  const token = (process.env.NEXT_PUBLIC_API_TOKEN || '').trim();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-token'] = token;

  const body = JSON.stringify(sub);

  let res = await fetch(`${BACKEND}/push/subscribe`, { method: 'POST', headers, body });
  if (!res.ok && res.status === 404) {
    res = await fetch(`${BACKEND}/push/register`, { method: 'POST', headers, body });
  }
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`[Push] register failed: ${res.status} ${msg}`);
  }
  console.log('[Push] register done');
}

/** ページが可視状態になるのを待つ */
function waitForVisible(): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((resolve) => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', onVis);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', onVis);
  });
}

/**
 * VAPID base64URL → BufferSource（ArrayBuffer を明示確保）
 *  - TS 5.6+ で Uint8Array<ArrayBufferLike> → BufferSource 互換エラーを回避
 */
function urlBase64ToUint8ArrayStrict(base64Url: string): BufferSource {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);

  // ★ ArrayBuffer を明示的に確保してから Uint8Array を作る
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);

  // Uint8Array は BufferSource を実装
  return out;
}

/** unknown エラーを読みやすい文字列に */
function errorToString(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
