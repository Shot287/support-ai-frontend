// public/sw.js

// 即時アクティベート
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// ★常にここへ飛ばす（デフォルト）
const DEFAULT_CLICK_URL = "https://support-ai-test.vercel.app/nudge";

// ---- Push受信 ----
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {}

  // mode の読み取り（互換: mode/status/runningフラグ）
  const mode =
    data.mode ??
    data.status ??
    (data.running === true ? "running" : data.running === false ? "stopped" : undefined);

  // タイトル/本文（デフォルト）
  const title =
    data.title ||
    (mode === "running" ? "継続中" : mode === "stopped" ? "停止中" : "お知らせ");

  const bodyDefault =
    mode === "running"
      ? "作業継続中です。"
      : mode === "stopped"
        ? "作業は停止中です。"
        : "通知が届きました。";

  const nowJST = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const body = `${data.body || data.message || bodyDefault}（受信: ${nowJST}）`;

  const icon = data.icon || "/icon-192.png";
  const badge = data.badge || "/badge-72.png";

  // 同種通知をまとめる（連続受信でも荒れにくい）
  const tag = data.tag || "five-minute-ping";

  const options = {
    body,
    icon,
    badge,
    tag,
    renotify: true,
    data, // ← ここに data.url が入っていればそれも保持される
    vibrate: [100, 50, 100],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---- クリック時：必ず /nudge へ ----
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // payloadにurlがあればそれを優先。無ければ必ず /nudge。
  const rawUrl =
    (event.notification && event.notification.data && event.notification.data.url) ||
    DEFAULT_CLICK_URL;

  const handleClick = async () => {
    // rawUrl が絶対URL/相対URLどちらでも扱えるように正規化
    let target;
    try {
      target = new URL(rawUrl, self.location.origin);
    } catch (_) {
      target = new URL(DEFAULT_CLICK_URL, self.location.origin);
    }

    const allClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    // 同一オリジンの /nudge が開いていればそれをフォーカス
    if (target.origin === self.location.origin) {
      for (const c of allClients) {
        try {
          const u = new URL(c.url);
          if (u.origin === target.origin && u.pathname.startsWith("/nudge")) {
            if ("focus" in c) return c.focus();
          }
        } catch (_) {}
      }
    }

    // 開いていなければ新規に開く
    return self.clients.openWindow(target.href);
  };

  event.waitUntil(handleClick());
});

// ---- 失効・再購読（将来のためのフック） ----
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of cs) {
        c.postMessage({ type: "PUSH_SUBSCRIPTION_INVALIDATED" });
      }
    })()
  );
});
