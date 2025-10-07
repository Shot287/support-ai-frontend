'use client';
import { useEffect } from 'react';

/**
 * Push通知 初期化（スマホ/スタンドアロン対応・冪等・詳細ログ付き）
 * フロー:
 *  1) ページが可視になってから実行（visibility対策）
 *  2) Service Worker登録 → ready待ち
 *  3) 通知許可: deniedなら中断 / defaultなら明示的に requestPermission()
 *  4) 既存購読の確認 → なければ VAPID取得 → subscribe()
 *  5) サーバ登録（/push/subscribe → なければ /push/register）
 */
export default function PushBootstrap() {
  useEffect(() => {
    let aborted = false;

    const run = async () => {
      try {
        // 1) 画面が見えてから（インストール直後のrace condition回避）
        if (document.visibilityState !== 'visible') {
          await waitForVisible();
        }
        if (aborted) return;

        // 2) SW登録 → ready待ち
        if (!('serviceWorker' in navigator)) {
          console.warn('[Push] Service Worker not supported');
          return;
        }
        const reg = await navigator.serviceWorker.register('/sw.js').catch((e) => {
          console.error('[Push] SW register failed:', e);
          throw e;
        });
        console.log('[Push] SW registered. scope =', reg.scope);
        const ready = await navigator.serviceWorker.ready;
        console.log('[Push] SW ready. scope =', ready.scope);

        // 3) 通知許可フロー
        if (typeof Notification !== 'undefined') {
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
        } else {
          console.warn('[Push] Notification API not available');
          return;
        }
        if (aborted) return;

        // 4) 既存購読の確認
        let sub = await ready.pushManager.getSubscription();
        if (sub) {
          console.log('[Push] already subscribed:', sub.endpoint);
          await safeRegisterToServer(sub);
          return;
        }

        // 4.1) VAPID鍵の取得（env → backend の順に試す）
        const vapid = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim() || (await fetchVapidFromBackend());
        if (!vapid) {
          console.error('[Push] VAPID public key is empty');
          return;
        }

        // 4.2) 購読（subscribe）
        try {
          sub = await ready.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapid),
          });
          console.log('[Push] subscribed:', sub.endpoint);
        } catch (err: any) {
          // よくあるエラーの切り分け
          if (err?.name === 'NotAllowedError') {
            console.error('[Push] NotAllowedError: 許可が拒否されています（ブラウザ/OS側でブロック）');
            return;
          }
          if (String(err).includes('applicationServerKey')) {
            console.error('[Push] applicationServerKey invalid: VAPID公開鍵に誤りの可能性');
            return;
          }
          console.error('[Push] subscribe failed once, retrying after ready re-check:', err);
          // readyを取り直して再試行（1回だけ）
          const ready2 = await navigator.serviceWorker.ready;
          sub = await ready2.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapid),
          });
          console.log('[Push] subscribed (retry):', sub.endpoint);
        }
        if (!sub) return;

        // 5) サーバへ登録
        await safeRegisterToServer(sub);
      } catch (e) {
        console.error('[Push] bootstrap error:', e);
      }
    };

    // 実行開始
    run();

    return () => {
      aborted = true;
    };
  }, []);

  return null;
}

/* ================ ユーティリティ ================ */

function getBackendOrigin(): string {
  // 既定：Render 本番
  const fallback = 'https://support-ai-os6k.onrender.com';
  const env = (process.env.NEXT_PUBLIC_BACKEND_ORIGIN || '').trim();
  return env || fallback;
}

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
      const j = await res.json().catch(() => ({} as any));
      const k = String(j.key ?? j.publicKey ?? '');
      return k.trim();
    } else {
      const t = (await res.text()).trim();
      return t;
    }
  } catch (e) {
    console.error('[Push] fetchVapidFromBackend error:', e);
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

/** VAPID base64URL → Uint8Array 変換 */
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = typeof atob !== 'undefined' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}
