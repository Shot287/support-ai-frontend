// public/sw.js

// 即時アクティベート
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ---- Push受信 ----
self.addEventListener('push', (event) => {
  // 受信データを安全にパース
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}

  // mode の読み取り（互換: mode/status/runningフラグ）
  const mode = data.mode ?? data.status ?? (data.running === true ? 'running' : data.running === false ? 'stopped' : undefined);

  // タイトル/本文（デフォルトを日本語で用意）
  const title =
    data.title ||
    (mode === 'running' ? '継続中' :
     mode === 'stopped' ? '停止中' : 'お知らせ');

  const bodyDefault =
    mode === 'running' ? '作業継続中です。' :
    mode === 'stopped' ? '作業は停止中です。' :
    '通知が届きました。';

  // JST の受信時刻を末尾に追記（視認性UP）
  const nowJST = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const body = `${(data.body || data.message || bodyDefault)}（受信: ${nowJST}）`;

  // アイコン/バッジ（存在しなくてもOK。任意のファイル名を使えるようフォールバック）
  const icon  = data.icon  || '/icon-192.png';
  const badge = data.badge || '/badge-72.png';

  // 一意タグで同種通知をまとめる（連続受信でも1スレッドで更新）
  const tag = data.tag || 'work-log-status';

  // 通知オプション
  const options = {
    body,
    icon,
    badge,
    tag,
    renotify: true,          // 同一tagで再通知時にヘッドアップ表示
    data,                    // クリック時に参照
    vibrate: [100, 50, 100], // モバイルで軽く振動
    requireInteraction: false, // 自動的に消える（必要なら true に）
    actions: [
      // { action: 'open', title: '開く' }, // ← 必要になったら有効化
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---- クリック時：既存タブを優先してフォーカス、なければ新規で開く ----
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = '/nudge/work-log'; // 既存実装どおり
  const handleClick = async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // 既に当該ページ（もしくは同ドメインの該当パス）が開いていればフォーカス
    for (const c of allClients) {
      try {
        const u = new URL(c.url);
        if (u.pathname.startsWith(url)) {
          if ('focus' in c) return c.focus();
        }
      } catch (_) {
        // ignore
      }
    }
    // 見つからなければ新規で開く
    return self.clients.openWindow(url);
  };

  event.waitUntil(handleClick());
});

// ---- 失効・再購読（将来のためのフック） ----
// 一部ブラウザで push 購読が失効した場合に呼ばれる。
// SW単体ではVAPID公開鍵がわからないため、クライアントに再購読を依頼するメッセージを送る。
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) {
      c.postMessage({ type: 'PUSH_SUBSCRIPTION_INVALIDATED' }); // ページ側で再購読処理（PushBootstrap/SubscribeControl）を呼ぶ
    }
  })());
});
