// src/features/push/SubscribeControl.tsx
"use client";
import { useEffect, useState } from "react";

type Phase = "idle" | "checking" | "subscribing" | "done" | "error";

export default function SubscribeControl() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [endpoint, setEndpoint] = useState<string>("");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator)) {
        setPhase("error");
        return;
      }
      try {
        await navigator.serviceWorker.register("/sw.js");
        const ready = await navigator.serviceWorker.ready;
        const sub = await ready.pushManager.getSubscription();
        if (sub) {
          setEndpoint(sub.endpoint);
          setPhase("done");
        } else {
          setPhase("idle");
        }
      } catch {
        setPhase("error");
      }
    })();
  }, []);

  const onSubscribe = async () => {
    try {
      setPhase("subscribing");

      const reg = await navigator.serviceWorker.register("/sw.js");
      const ready = await navigator.serviceWorker.ready;

      if (typeof Notification === "undefined") {
        throw new Error("この端末は通知APIに対応していません");
      }
      if (Notification.permission === "denied") {
        throw new Error("通知がブロックされています（端末/Chromeの設定で許可に変更してください）");
      }
      if (Notification.permission === "default") {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          throw new Error("通知許可が得られませんでした");
        }
      }

      let sub = await ready.pushManager.getSubscription();
      if (!sub) {
        const vapid =
          (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim() ||
          (await fetchVapidFromBackend());
        if (!vapid) throw new Error("VAPID公開鍵の取得に失敗しました");

        const key: BufferSource = urlBase64ToUint8ArrayStrict(vapid);
        sub = await ready.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
      }

      await registerToServer(sub);
      setEndpoint(sub.endpoint);
      setPhase("done");
      alert("Push購読の登録が完了しました。以後、スマホにも通知が届きます。");
    } catch (e) {
      console.error("[Subscribe] failed:", errorToString(e));
      setPhase("idle");
      alert(`Push購読に失敗しました：${errorToString(e)}`);
    }
  };

  const onUnsubscribe = async () => {
    try {
      setPhase("checking");
      const ready = await navigator.serviceWorker.ready;
      const sub = await ready.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await unregisterOnServerSafe(sub).catch(() => {});
      }
      setEndpoint("");
      setPhase("idle");
      alert("Push購読を解除しました。");
    } catch (e) {
      console.error("[Subscribe] unsubscribe error:", errorToString(e));
      setPhase("error");
      alert(`購読解除に失敗しました：${errorToString(e)}`);
    }
  };

  // ✅ 先に計算しておく（この変数は boolean なので TS2367 を起こさない）
  const isBusy: boolean = phase === "subscribing" || phase === "checking";

  return (
    <div className="rounded-xl border p-4">
      <h2 className="font-semibold mb-2">Push通知の購読</h2>

      {phase === "checking" && <p className="text-sm text-gray-600">状態を確認中…</p>}

      {(phase === "idle" || phase === "error") && (
        <div className="flex items-center gap-3">
          <button
            onClick={onSubscribe}
            className="rounded-xl bg-black px-5 py-2 text-white hover:opacity-90 disabled:bg-gray-300"
            disabled={isBusy} // ← ここで直接 phase を比較しない
          >
            Push購読を有効にする
          </button>
          <p className="text-sm text-gray-600">
            押すと「通知を許可しますか？」が表示され、許可後に購読が作成されます。
          </p>
        </div>
      )}

      {phase === "subscribing" && <p className="text-sm text-gray-600">購読を作成中…</p>}

      {phase === "done" && (
        <div className="space-y-2">
          <div className="text-green-700 text-sm">✅ 購読済みです</div>
          <div className="text-xs break-all text-gray-600">{endpoint}</div>
          <button
            onClick={onUnsubscribe}
            className="rounded-xl border px-4 py-2 hover:bg-gray-50"
          >
            購読を解除する
          </button>
        </div>
      )}
    </div>
  );
}

/* ==== 内部ユーティリティ ==== */

function getBackendOrigin(): string {
  const fallback = "https://support-ai-os6k.onrender.com";
  const env = (process.env.NEXT_PUBLIC_BACKEND_ORIGIN || "").trim();
  return env || fallback;
}

type VapidJson = { key?: unknown; publicKey?: unknown };

async function fetchVapidFromBackend(): Promise<string> {
  const BACKEND = getBackendOrigin();
  const res = await fetch(`${BACKEND}/push/vapid-public-key`, { method: "GET" });
  if (!res.ok) return "";
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = (await res.json()) as VapidJson;
    const raw =
      (typeof j.key === "string" ? j.key : typeof j.publicKey === "string" ? j.publicKey : "") || "";
    return raw.trim();
  }
  return (await res.text()).trim();
}

async function registerToServer(sub: PushSubscription): Promise<void> {
  const BACKEND = getBackendOrigin();
  const token = (process.env.NEXT_PUBLIC_API_TOKEN || "").trim();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-token"] = token;
  const body = JSON.stringify(sub);

  let r = await fetch(`${BACKEND}/push/subscribe`, { method: "POST", headers, body });
  if (!r.ok && r.status === 404) {
    r = await fetch(`${BACKEND}/push/register`, { method: "POST", headers, body });
  }
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`register failed: ${r.status} ${msg}`);
  }
}

async function unregisterOnServerSafe(sub: PushSubscription): Promise<void> {
  const BACKEND = getBackendOrigin();
  try {
    await fetch(`${BACKEND}/push/unsubscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    // 無ければスキップ
  }
}

/** VAPID base64URL → BufferSource（ArrayBuffer を明示確保） */
function urlBase64ToUint8ArrayStrict(base64Url: string): BufferSource {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out; // Uint8Array は BufferSource
}

function errorToString(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
