// src/features/push/PushBootstrap.tsx
'use client';
import { useEffect } from 'react';
import { getVapidPublicKey, apiPost } from '@/lib/api';

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
            armUserGestureFallback();
            return;
          }
        }

        // 5) VAPID取得（env → backend の順）
        const envVapid = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();
        const vapid = envVapid || (await fetchVapidFromBackend());
        console.log('[Push] using VAPID from', envVapid ? 'env' : 'backend');
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
          armUserGestureFallback();
          return;
        }

        if (!sub) return;

        // 7) サーバ登録
        await safeRegisterToServer(sub);
      } catch (e: unknown) {
        console.error('[Push] bootstrap error:', errorToString(e));
        armUserGestureFallback();
      }
    };

    // ---- フォールバック: 最初のユーザー操作で run() を再起動 ----
    const armUserGestureFallback = () => {
      if (armed) return;
      armed = true;
      const once = async () => {
        removeListeners();
        await run('user-gesture');
      };
      document.addEventListener('click', once, { once: true, capture: true });
      document.addEventListener('touchstart', once, { once: true, capture: true });
      document.addEventListener('keydown', once, { once: true, capture: true });
      console.log('[Push] armed: waiting for first user gesture to request/subscribe');
    };
    const removeListeners = () => {
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

// /api/_b 経由で VAPID 公開鍵を取得（文字列/JSON 両対応 & 未定義ガード）
async function fetchVapidFromBackend(): Promise<string> {
  try {
    const res: unknown = await getVapidPublicKey(); // /api/_b/push/vapid-public-key
    let raw = '';
    if (typeof res === 'string') {
      raw = res;
    } else if (res && typeof (res as any).publicKey === 'string') {
      raw = (res as any).publicKey;
    } else if (res && typeof (res as any).key === 'string') {
      // 旧実装互換
      raw = (res as any).key;
    }
    return (raw || '').trim();
  } catch (e: unknown) {
    console.error('[Push] failed to fetch VAPID:', errorToString(e));
    return '';
  }
}

/** サブスクリプションをバックエンドへ登録（/push/subscribe → /push/register） */
async function safeRegisterToServer(sub: PushSubscription): Promise<void> {
  try {
    await apiPost(`/push/subscribe`, sub);
    console.log('[Push] register done');
  } catch (err: unknown) {
    console.error('[Push] register failed:', errorToString(err));
    // 古い環境では /push/register にフォールバック（任意）
    try {
      await apiPost(`/push/register`, sub);
      console.log('[Push] fallback register done');
    } catch (e: unknown) {
      console.error('[Push] fallback register failed:', errorToString(e));
    }
  }
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
 * VAPID base64URL → BufferSource（強耐性版）
 */
function urlBase64ToUint8ArrayStrict(input: string): BufferSource {
  if (!input) throw new Error('empty VAPID key');

  // PEM対応
  const pemMatch = input.match(/-----BEGIN PUBLIC KEY-----([\s\S]*?)-----END PUBLIC KEY-----/);
  let s = pemMatch ? pemMatch[1] : input;

  s = s
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\r\n\t\f ]+/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/[^A-Za-z0-9\-_+/=]/g, '');

  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';

  try {
    const raw = atob(s);
    const buf = new ArrayBuffer(raw.length);
    const out = new Uint8Array(buf);
    for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    const head = s.slice(0, 12);
    const tail = s.slice(-12);
    throw new Error(`invalid base64 after normalize (len=${s.length}, head=${head}..., tail=...${tail})`);
  }
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
