"use client";

import { useEffect, useMemo, useState } from "react";

/** ====== types ====== */
type Health = { ok: boolean };
type Echo = { echo: string };
type PrivateResp = { secret: boolean; msg: string };

type NudgeEvent = {
  id: number;
  type: string; // "five_second_rule" など
  started_at: string; // ISO8601
  ended_at: string;   // ISO8601
  duration_sec: number;
  note?: string;
};

/** ====== env ====== */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN ?? "";
const COMMIT =
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  "local";

/** ====== BIG UI (verifier) ====== */
const BIG_TAGLINE =
  "✅ Support-AI v2 — Connectivity & Nudge Dashboard / これは新しいUIです";

/** ====== helpers ====== */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

async function clearAllCaches() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } finally {
    location.reload();
  }
}

/** ====== audio/vibrate ====== */
function beep(durationMs = 100, freq = 880) {
  try {
    const globalWin = window as unknown as { webkitAudioContext?: typeof AudioContext };
    const Ctx: typeof AudioContext =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
      globalWin.webkitAudioContext!;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, durationMs);
  } catch {
    // 無音でも処理継続
  }
}
function vibrate(ms = 80) {
  if ("vibrate" in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {
      /* noop */
    }
  }
}

export default function Page() {
  /* ====== device info ====== */
  const [info, setInfo] = useState({
    w: 0,
    h: 0,
    dpr: 1,
    ua: "",
    online: true,
  });

  /* ====== api states ====== */
  const [text, setText] = useState("from brand-new UI");
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [health, setHealth] = useState<Health | null>(null);
  const [echo, setEcho] = useState<Echo | null>(null);
  const [priv, setPriv] = useState<PrivateResp | null>(null);
  const [err, setErr] = useState("");

  const hasApiBase = useMemo(
    () => !!API_BASE && API_BASE.startsWith("http"),
    []
  );

  /* ====== api helpers ====== */
  async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
    if (!hasApiBase) throw new Error("NEXT_PUBLIC_API_BASE が未設定です。");
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
      credentials: "omit",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`API ${res.status} ${res.statusText}: ${body}`);
    }
    return (await res.json()) as T;
  }

  async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
    if (!hasApiBase) throw new Error("NEXT_PUBLIC_API_BASE が未設定です。");
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${res.status} ${res.statusText}: ${text}`);
    }
    return (await res.json()) as T;
  }

  /* ====== lifecycle ====== */
  useEffect(() => {
    const read = () =>
      setInfo({
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: window.devicePixelRatio ?? 1,
        ua: navigator.userAgent,
        online: navigator.onLine,
      });
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

  // 初回に /health
  useEffect(() => {
    (async () => {
      setErr("");
      setHealth(null);
      if (!hasApiBase) return;
      try {
        const r = await apiGet<Health>("/health");
        setHealth(r);
      } catch (e: unknown) {
        setErr(getErrorMessage(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ====== 先延ばし対策：5秒カウント ====== */
  const FIVE_SEC = 5;
  const [counting, setCounting] = useState(false);
  const [remain, setRemain] = useState(FIVE_SEC);
  const [lastNudges, setLastNudges] = useState<NudgeEvent[]>([]);
  const [nudgeErr, setNudgeErr] = useState("");

  async function fetchNudges() {
    try {
      const list = await apiGet<NudgeEvent[]>("/nudge/events?limit=10");
      setLastNudges(list);
    } catch (e: unknown) {
      setNudgeErr(getErrorMessage(e));
    }
  }
  useEffect(() => {
    if (hasApiBase) void fetchNudges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasApiBase]);

  async function startCountdown() {
    if (counting) return;
    setNudgeErr("");
    setCounting(true);
    setRemain(FIVE_SEC);
    const started = Date.now();
    beep(100, 880);
    vibrate(60);

    const timer = setInterval(() => {
      setRemain((r) => {
        if (r <= 1) {
          clearInterval(timer);
          beep(140, 980);
          vibrate(140);
          setCounting(false);

          const ended = Date.now();
          // 記録をサーバへ
          (async () => {
            try {
              const payload = {
                type: "five_second_rule",
                started_at: new Date(started).toISOString(),
                ended_at: new Date(ended).toISOString(),
                duration_sec: Math.round((ended - started) / 1000),
              };
              const saved = await apiPost<NudgeEvent>("/nudge/event", payload);
              setLastNudges((arr) => [saved, ...arr].slice(0, 10));
            } catch (e: unknown) {
              setNudgeErr(getErrorMessage(e));
            }
          })();

          return FIVE_SEC; // 表示初期化
        }
        beep(60, 820);
        vibrate(30);
        return r - 1;
      });
    }, 1000);
  }

  /* ====== UI ====== */
  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-zinc-50">
      {/* HERO */}
      <section className="border-b border-white/10">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <p className="text-xs tracking-widest text-emerald-300/80">NEW UI</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold">{BIG_TAGLINE}</h1>
          <p className="mt-2 text-sm text-zinc-300/80">
            commit: <code className="text-emerald-300">{COMMIT}</code> / API_BASE:{" "}
            <code className="text-emerald-300">
              {API_BASE || "(未設定 — Vercel の環境変数を確認)"}
            </code>
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={clearAllCaches}
              className="rounded-lg bg-emerald-500/90 hover:bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-900"
              title="Service Worker とブラウザキャッシュを全削除して再読込します"
            >
              キャッシュ削除 & 再読込
            </button>
            <a
              href="#diagnostics"
              className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
            >
              下の診断にジャンプ
            </a>
          </div>
        </div>
      </section>

      {/* DIAGNOSTICS */}
      <section
        id="diagnostics"
        className="mx-auto max-w-5xl px-4 py-8 grid gap-6 md:grid-cols-2"
      >
        {/* device card */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <h2 className="text-lg font-bold">端末情報</h2>
          <div className="mt-3 grid grid-cols-2 gap-y-1 text-sm text-zinc-300">
            <div>innerWidth</div>
            <div className="text-right">{info.w}px</div>
            <div>innerHeight</div>
            <div className="text-right">{info.h}px</div>
            <div>devicePixelRatio</div>
            <div className="text-right">{info.dpr}</div>
            <div>online</div>
            <div className="text-right">{String(info.online)}</div>
          </div>
          <details className="mt-3 text-xs text-zinc-400 break-all">
            <summary>userAgent</summary>
            {info.ua}
          </details>
        </div>

        {/* api card */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <h2 className="text-lg font-bold">API 診断</h2>

          <div className="mt-2 text-xs text-zinc-300/80">
            <div>
              API_BASE: <code className="text-emerald-300">{API_BASE || "(未設定)"}</code>
            </div>
            <div className="mt-1">
              /health:{" "}
              <code className="text-emerald-300">
                {health ? JSON.stringify(health) : "(未取得)"}
              </code>
            </div>
          </div>

          {/* echo */}
          <div className="mt-4 space-y-2">
            <label className="block text-sm">
              エコー文字列
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400"
                placeholder="from phone など"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-md bg-white text-zinc-900 px-3 py-2 text-sm font-semibold"
                onClick={async () => {
                  setErr("");
                  setEcho(null);
                  try {
                    const q = text || "from phone";
                    const r = await apiGet<Echo>(`/v1/echo?q=${encodeURIComponent(q)}`);
                    setEcho(r);
                  } catch (e: unknown) {
                    setErr(getErrorMessage(e));
                  }
                }}
                disabled={!hasApiBase}
              >
                /v1/echo
              </button>
              <button
                className="rounded-md border border-white/20 px-3 py-2 text-sm"
                onClick={async () => {
                  setErr("");
                  try {
                    const r = await apiGet<Health>("/health");
                    setHealth(r);
                  } catch (e: unknown) {
                    setErr(getErrorMessage(e));
                  }
                }}
                disabled={!hasApiBase}
              >
                /health 再取得
              </button>
            </div>
            <div className="text-sm text-zinc-300">
              結果:{" "}
              <code className="text-emerald-300">
                {echo ? JSON.stringify(echo) : "(未実行)"}
              </code>
            </div>
          </div>

          {/* private */}
          <div className="mt-5 space-y-2">
            <label className="block text-sm">
              x-token（保護API）
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400"
                placeholder="Render の API_TOKEN と同じ値"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-md border border-white/20 px-3 py-2 text-sm"
                onClick={async () => {
                  setErr("");
                  setPriv(null);
                  try {
                    const r = await apiGet<PrivateResp>("/v1/private", {
                      headers: { "x-token": token || "" },
                    });
                    setPriv(r);
                  } catch (e: unknown) {
                    setErr(getErrorMessage(e));
                  }
                }}
                disabled={!hasApiBase}
              >
                /v1/private
              </button>
            </div>
            <div className="text-sm text-zinc-300">
              結果:{" "}
              <code className="text-emerald-300">
                {priv ? JSON.stringify(priv) : "(未実行)"}
              </code>
            </div>
          </div>

          {err && (
            <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300">
              Error: {err}
            </p>
          )}
        </div>
      </section>

      {/* PROCRASTINATION BUSTER: 5秒カウントダウン */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <h2 className="text-lg font-bold">先延ばし対策：5秒ルール</h2>
          <p className="mt-1 text-sm text-zinc-300/80">
            「やる」と決めて<strong>5秒以内</strong>に体を動かす。カウントが終わったら“今すぐ最初の一歩”を踏み出そう。
          </p>

          <div className="mt-4 flex items-center gap-4">
            <button
              className="rounded-lg bg-emerald-500/90 hover:bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-60"
              onClick={startCountdown}
              disabled={!hasApiBase || counting}
            >
              {counting ? "カウント中..." : "5秒カウント開始"}
            </button>
            <div className="text-5xl font-extrabold tabular-nums tracking-wider">
              {remain}
            </div>
          </div>

          {nudgeErr && (
            <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300">
              Error: {nudgeErr}
            </p>
          )}

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-zinc-200">最近の記録</h3>
            <ul className="mt-2 space-y-1 text-sm text-zinc-300">
              {lastNudges.length === 0 && (
                <li className="opacity-70">（まだありません）</li>
              )}
              {lastNudges.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center justify-between rounded-md border border-white/10 bg-black/30 px-3 py-2"
                >
                <span>🚀 {n.type} / {n.duration_sec}秒</span>
                <time className="opacity-70">
                  {new Date(n.ended_at).toLocaleString()}
                </time>
              </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* SCROLLER */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <h2 className="text-lg font-bold">スクロール検証</h2>
          <div className="mt-3 h-48 overflow-y-auto rounded-md border border-white/10 bg-black/30 p-3 text-sm text-zinc-300">
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i}>Item {i + 1}</div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER / ANCHOR */}
      <footer className="border-t border-white/10 bg-black/30">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between text-sm text-zinc-400">
          <span>Bottom Bar — {BIG_TAGLINE}</span>
          <a
            href="#top"
            className="rounded-md border border-white/20 px-3 py-1 hover:bg-white/5"
          >
            上へ
          </a>
        </div>
      </footer>
    </main>
  );
}
