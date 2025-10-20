// src/features/push/SubscribeControl.tsx
"use client";
import { useEffect, useState } from "react";
import { getVapidPublicKey, apiPost } from "@/lib/api";

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

      await navigator.serviceWorker.register("/sw.js");
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
        // ✅ /api/_b 経由で VAPID を取得
        const envVapid = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();
        const vapid = envVapid || (await fetchVapidFromBackend());
        console.log("[Subscribe] using VAPID from", envVapid ? "env" : "backend");
        if (!vapid) throw new Error("VAPID公開鍵の取得に失敗しました");

        const key: BufferSource = urlBase64ToUint8ArrayStrict(vapid);
        sub = await ready.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
      }

      // ✅ バックエンドへ登録
      await registerToServer(sub);
      setEndpoint(sub.endpoint);
      setPhase("done");
      alert("Push購読の登録が完了しました。以後、スマホにも通知が届きます。");
    } catch (e: unknown) {
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
    } catch (e: unknown) {
      console.error("[Subscribe] unsubscribe error:", errorToString(e));
      setPhase("error");
      alert(`購読解除に失敗しました：${errorToString(e)}`);
    }
  };

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
            disabled={isBusy}
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

/* ==== 内部ユーティリティ（/api/_b 経由版） ==== */

// 文字列/JSON どちらのレスポンスでも安全に取り出す
async function fetchVapidFromBackend(): Promise<string> {
  try {
    const res: unknown = await getVapidPublicKey(); // { publicKey: string } or "rawstring"
    let raw = "";
    if (typeof res === "string") raw = res;
    else if (res && typeof (res as any).publicKey === "string") raw = (res as any).publicKey;
    else if (res && typeof (res as any).key === "string") raw = (res as any).key; // 旧互換
    return (raw || "").trim();
  } catch (e: unknown) {
    console.error("[Subscribe] failed to fetch VAPID:", errorToString(e));
    return "";
  }
}

async function registerToServer(sub: PushSubscription): Promise<void> {
  try {
    await apiPost(`/push/subscribe`, sub);
  } catch {
    // 古いバックエンド互換
    await apiPost(`/push/register`, sub);
  }
}

async function unregisterOnServerSafe(sub: PushSubscription): Promise<void> {
  try {
    await apiPost(`/push/unsubscribe`, { endpoint: sub.endpoint });
  } catch {
    // 無ければスキップ
  }
}

/**
 * VAPID base64URL → BufferSource（強耐性版）
 */
function urlBase64ToUint8ArrayStrict(input: string): BufferSource {
  if (!input) throw new Error("empty VAPID key");

  const pemMatch = input.match(/-----BEGIN PUBLIC KEY-----([\s\S]*?)-----END PUBLIC KEY-----/);
  let s = pemMatch ? pemMatch[1] : input;

  s = s
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\r\n\t\f ]+/g, "")
    .replace(/^"+|"+$/g, "")
    .replace(/[^A-Za-z0-9\-_+/=]/g, "");

  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";

  try {
    const raw = atob(s);
    const buf = new ArrayBuffer(raw.length);
    const out = new Uint8Array(buf);
    for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    const head = s.slice(0, 12);
    const tail = s.slice(-12);
    throw new Error(
      `invalid base64 after normalize (len=${s.length}, head=${head}..., tail=...${tail})`
    );
  }
}

function errorToString(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
