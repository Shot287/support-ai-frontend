// public/sw.js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const mode = data.mode;
  const title = data.title || (mode === 'running' ? '継続中' : mode === 'stopped' ? '停止中' : 'お知らせ');
  const body  = data.body  || (mode === 'running' ? '作業継続中です。' : mode === 'stopped' ? '作業は停止中です。' : '通知が届きました。');

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: 'work-log-status',
      renotify: true,
      icon: '/icon-192.png',   // あれば public/ に置く（無くても可）
      badge: '/badge-72.png',  // あれば public/ に置く（無くても可）
      data
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = '/nudge/work-log';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
