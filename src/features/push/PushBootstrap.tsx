'use client';
import { useEffect } from 'react';

/**
 * Push通知 初期化（モバイルでの権限プロンプト抑制に強い版）
 * - 起動直後に実行（可視化待ち）
 * - 既存購読が無ければ subscribe
 * - 権限が default のままなら、最初のユーザー操作(click/touchstart/keydown)で再実行
 */
export default function PushBootstrap() {
  useEffect(() => {
    let aborted = false;
    let armed = false; // フォールバックが武装済みか

    const run = async (reason: string) => {
      try {
        if (document.visibilityState !== 'visible') {
          await waitForVisible();
        }
        if (aborted) return;

        if (!('serviceWorker' in navigator)) {
          console.warn('[Push] SW not supported');
          return;
        }

        // 1) SW登録 → ready
        const reg = await navigator.serviceWorker.register('/sw.js').catch((e: unknown) => {
          console.error('[Push] SW register failed:', errorToString(e));
          throw e;
        });
        console.log(`[Push] SW registered (${reason}). scope =`, reg.scope);

        const ready = await navigator.serviceWorker.ready;

        // 2) 許可確認
        if (typeof Notification === 'undefined') {
          console.warn('[Push] Notification API not available');
          return;
        }
        if (Notification.permission === 'denied') {
          console.warn('[Push] permission DENIED（端末/Chrome側で許可にしてください）');
          return;
        }

        // 3) 既存購読チェック（冪等）
        let sub = await ready.pushManager.getSubscription();
        if (sub) {
          console.log('[Push] already subscribed:', sub.endpoint);
          await safeRegisterToServer(sub); // 念のため再登録
          return;
        }

        // 4) 許可が default の場合は、まず要求してみる
        if (Notification.permission === 'default') {
          const perm = await Notification.requestPermission();
          console.log('[Push] requestPermission:', perm);
          if (perm !== 'granted') {
            // ここで出ずに quiet/抑制される端末がある → ユーザー操作フォールバックを武装
            armUserGestureFallback();
            return;
          }
        }

        // 5) VAPID取得（env → backend の順）
        const vapid =
          (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim() ||
          (await fetchVapidFromBackend());
        if (!vapid) {
          console.error('[Push] VAPID public key is empty');
          return;
        }

        // 6) 購読
        const key: BufferSource = urlBase64ToUint8ArrayStrict(vapid);
        try {
          sub = await ready.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          });
          console.log('[Push] subscribed:', sub.endpoint);
        } catch (err: unknown) {
          const msg = errorToString(err);
          console.error('[Push] subscribe failed:', msg);
          if (msg.toLowerCase().includes('applicationserverkey')) {
            console.error('[Push] VAPID公開鍵の形式/値を確認してください');
          }
          // ここもユーザー操作後に通るケースがある
          armUserGestureFallback();
          return;
        }

        if (!sub) return;

        // 7) サーバ登録
        await safeRegisterToServer(sub);
      } catch (e: unknown) {
        console.error('[Push] bootstrap error:', errorToString(e));
        // 失敗時もフォールバックを武装
        armUserGestureFallback();
      }
    };

    // ---- フォールバック: 最初のユーザー操作で run() を再起動 ----
    const armUserGestureFallback = () => {
      if (armed) return;
      armed = true;
      const once = async () => {
        removeListeners();
        // “ユーザー操作の直後”にもう一度トライ
        await run('user-gesture');
      };
      document.addEventListener('click', once, { once: true, capture: true });
      document.addEventListener('touchstart', once, { once: true, capture: true });
      document.addEventListener('keydown', once, { once: true, capture: true });
      console.log('[Push] armed: waiting for first user gesture to request/subscribe');
    };
    const removeListeners = () => {
      // イベントを全削除（once指定だが保険で）
      const dummy = () => {};
      document.removeEventListener('click', dummy, true);
      document.removeEventListener('touchstart', dummy, true);
      document.removeEventListener('keydown', dummy, true);
    };

    // 初回起動
    run('boot');

    return () => {
      aborted = true;
      removeListeners();
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
 *  - TS 5.6+ の型互換問題を回避
 */
function urlBase64ToUint8ArrayStrict(base64Url: string): BufferSource {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out; // Uint8Array は BufferSource
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
