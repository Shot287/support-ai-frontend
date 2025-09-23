"use client";

import { useEffect, useState } from "react";

type Health = { ok: boolean };
type Echo = { echo: string };
type PrivateResp = { secret: boolean; msg: string };

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN ?? "";
const COMMIT = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
               process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
               "local";

export default function Home() {
  // 画面情報
  const [info, setInfo] = useState({
    w: 0,
    h: 0,
    dvh: 0,
    dpr: 0,
    ua: "",
    online: true,
  });
  const [text, setText] = useState("");
  const [count, setCount] = useState(0);

  // API状態
  const [health, setHealth] = useState<Health | null>(null);
  const [echo, setEcho] = useState<Echo | null>(null);
  const [priv, setPriv] = useState<PrivateResp | null>(null);
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [err, setErr] = useState<string>("");

  const hasApiBase = !!API_BASE && API_BASE.startsWith("http");

  // APIヘルパ
  async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
    if (!hasApiBase) throw new Error("NEXT_PUBLIC_API_BASE が未設定です。");
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`API ${res.status} ${res.statusText}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  // 画面情報の更新
  const read = () =>
    setInfo({
      w: window.innerWidth,
      h: window.innerHeight,
      dvh: Math.round((window.innerHeight / 100) * 100) / 100,
      dpr: window.devicePixelRatio ?? 1,
      ua: navigator.userAgent,
      online: navigator.onLine,
    });

  useEffect(() => {
    read();
    const onResize = () => read();
    const onOnline = () => read();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
    };
  }, []);

  // 初回に /health を確認
  useEffect(() => {
    (async () => {
      setErr("");
      setHealth(null);
      if (!hasApiBase) return;
      try {
        const r = await apiGet<Health>("/health");
        setHealth(r);
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SW/キャッシュ一括クリア
  async function clearCaches() {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      location.reload();
    } catch (e) {
      console.warn(e);
      alert("キャッシュのクリアでエラーが発生しました。");
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* 固定ヘッダ */}
      <header className="sticky top-0 z-10 border-b border-black/10 dark:border-white/15 bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold">スマホ動作確認ページ</h1>
            <span className="text-[11px] opacity-70">commit: {COMMIT}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs opacity-70">Tailwind v4 / PWA 準備済み</span>
            <button
              className="text-xs rounded border px-2 py-1"
              onClick={clearCaches}
              title="古いPWAキャッシュ/Service Workerを削除してリロード"
            >
              キャッシュ削除
            </button>
          </div>
        </div>
      </header>

      {/* APIベース未設定のアラート */}
      {!hasApiBase && (
        <div className="mx-auto max-w-3xl px-4 pt-4">
          <div className="rounded border border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200 p-3 text-sm">
            <strong>注意:</strong> <code>NEXT_PUBLIC_API_BASE</code> が未設定です。
            Vercel の環境変数（Preview）に
            <code>https://support-ai-os6k.onrender.com</code> を設定してください。
          </div>
        </div>
      )}

      {/* 本体 */}
      <div className="mx-auto max-w-3xl px-4 py-5 space-y-6">
        {/* デバイス情報 */}
        <section className="rounded border border-black/10 dark:border-white/15 p-3 bg-white dark:bg-black/10">
          <h2 className="font-semibold mb-2">デバイス情報</h2>
          <div className="grid grid-cols-2 gap-y-1 text-sm">
            <div>innerWidth</div><div className="text-right">{info.w}px</div>
            <div>innerHeight</div><div className="text-right">{info.h}px</div>
            <div>devicePixelRatio</div><div className="text-right">{info.dpr}</div>
            <div>online</div><div className="text-right">{String(info.online)}</div>
          </div>
          <details className="mt-2 text-xs opacity-80 break-all">
            <summary>userAgent</summary>
            {info.ua}
          </details>
        </section>

        {/* API 接続テスト */}
        <section className="rounded border border-black/10 dark:border-white/15 p-3 bg-white dark:bg-black/10 space-y-3">
          <h2 className="font-semibold">API 接続テスト</h2>

          <div className="text-xs opacity-80 break-all">
            <div><span className="opacity-70">API_BASE:</span> <code>{API_BASE || "(未設定)"}</code></div>
            <div className="mt-1"><span className="opacity-70">/health:</span> <code>{health ? JSON.stringify(health) : "(未取得)"}</code></div>
          </div>

          {/* /v1/echo */}
          <div className="space-y-2">
            <label className="block text-sm">
              エコー文字列
              <input
                className="mt-1 w-full rounded border border-black/10 dark:border-white/15 p-2 bg-white dark:bg-black/10 outline-none focus:ring-2 focus:ring-black/20"
                placeholder="from phone など"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded bg-black text-white h-10 px-4"
                onClick={async () => {
                  setErr(""); setEcho(null);
                  try {
                    const q = text || "from phone";
                    const r = await apiGet<Echo>(`/v1/echo?q=${encodeURIComponent(q)}`);
                    setEcho(r);
                  } catch (e: any) {
                    setErr(e?.message ?? String(e));
                  }
                }}
                disabled={!hasApiBase}
              >
                /v1/echo を呼ぶ
              </button>
              <span className="text-sm break-all">
                結果: <code>{echo ? JSON.stringify(echo) : "(未実行)"}</code>
              </span>
              <button
                className="rounded border border-black/10 dark:border-white/15 h-10 px-3"
                onClick={async () => {
                  setErr("");
                  try {
                    const r = await apiGet<Health>("/health");
                    setHealth(r);
                  } catch (e: any) {
                    setErr(e?.message ?? String(e));
                  }
                }}
                disabled={!hasApiBase}
              >
                /health リトライ
              </button>
            </div>
          </div>

          {/* /v1/private */}
          <div className="space-y-2">
            <label className="block text-sm">
              x-token（保護API用）
              <input
                className="mt-1 w-full rounded border border-black/10 dark:border-white/15 p-2 bg-white dark:bg-black/10 outline-none focus:ring-2 focus:ring-black/20"
                placeholder="Render の API_TOKEN と同じ値"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded border border-black/10 dark:border-white/15 h-10 px-4"
                onClick={async () => {
                  setErr(""); setPriv(null);
                  try {
                    const r = await apiGet<PrivateResp>("/v1/private", {
                      headers: { "x-token": token || "" },
                    });
                    setPriv(r);
                  } catch (e: any) {
                    setErr(e?.message ?? String(e));
                  }
                }}
                disabled={!hasApiBase}
              >
                /v1/private を呼ぶ
              </button>
              <span className="text-sm break-all">
                結果: <code>{priv ? JSON.stringify(priv) : "(未実行)"}</code>
              </span>
            </div>
          </div>

          {err && <p className="text-sm text-red-600 break-all">Error: {err}</p>}
        </section>

        {/* タップ&スクロール確認 */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <button className="rounded bg-black text-white h-10 px-4" onClick={() => setCount((c) => c + 1)}>
              タップ (+1)
            </button>
            <span>count: <strong>{count}</strong></span>
            <button className="rounded border border-black/10 dark:border-white/15 h-10 px-4" onClick={() => setCount(0)}>
              リセット
            </button>
          </div>

          <div className="rounded border border-black/10 dark:border-white/15 p-3 bg-white dark:bg-black/10 h-48 overflow-y-auto">
            <p className="text-sm opacity-80">スクロール確認用のボックスです。スマホで指でスクロールしてみてください。</p>
            <ul className="list-disc pl-5 text-sm space-y-1 mt-2">
              {Array.from({ length: 30 }).map((_, i) => (<li key={i}>Item {i + 1}</li>))}
            </ul>
          </div>
        </section>

        {/* キーボード挙動確認 */}
        <section className="space-y-2">
          <label className="block text-sm font-medium">
            入力（ソフトキーボード表示・隠れるか確認）
            <input
              className="mt-1 w-full rounded border border-black/10 dark:border-white/15 p-2 bg-white dark:bg-black/10 outline-none focus:ring-2 focus:ring-black/20"
              placeholder="ここに入力"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p className="text-sm opacity-70">値: {text || "(空)"}</p>
        </section>

        {/* 下部余白（安全領域） */}
        <div className="h-[16dvh]" />
      </div>

      {/* 固定ボトムバー */}
      <div className="fixed inset-x-0 bottom-0 bg-background/90 backdrop-blur border-t border-black/10 dark:border-white/15">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <span className="text-sm opacity-70">Bottom Bar</span>
          <a className="rounded bg-black text-white h-10 px-4 flex items-center" href="#top">
            上へ
          </a>
        </div>
      </div>
    </main>
  );
}
