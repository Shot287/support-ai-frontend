// src/features/study/StudyTimer.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as ReactDOM from "react-dom/client";

/**
 * PC限定 学習タイマー（Document Picture-in-Picture）
 * - 5分固定のカウントダウンのみ
 * - 無音（終了時は小ウィンドウ側の視覚演出で通知）
 * - 同期なし（localStorageのみ）
 * - どのページでも起動できる常駐ドック + study-timer:open イベントで起動
 */

const DURATION_MS = 5 * 60 * 1000;
const STORAGE_KEY = "study_timer:v2_simple5min";

type SavedState = {
  remainMs: number;
  running: boolean;
  anchorEpoch?: number;
};

const DEFAULT: SavedState = {
  remainMs: DURATION_MS,
  running: false,
};

const isMobile = () =>
  typeof navigator !== "undefined" &&
  /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

function mmss(ms: number) {
  const pos = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(pos / 60);
  const s = pos % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function load(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const obj = JSON.parse(raw) as SavedState;
    // 再読み込み時の復元
    if (obj.running && obj.anchorEpoch) {
      const delta = Date.now() - obj.anchorEpoch;
      obj.remainMs = Math.max(0, obj.remainMs - delta);
      if (obj.remainMs <= 0) {
        obj.running = false;
        obj.anchorEpoch = undefined;
      } else {
        obj.anchorEpoch = Date.now();
      }
    }
    // 5分固定に合わせる（古い保存値が長い場合も整合）
    if (obj.remainMs > DURATION_MS) obj.remainMs = DURATION_MS;
    return obj;
  } catch {
    return DEFAULT;
  }
}

function save(s: SavedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

/** Document Picture-in-Picture 型補助 */
type DocumentPiP = {
  requestWindow: (options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
  }) => Promise<Window>;
};

export default function StudyTimer() {
  const dPiP: DocumentPiP | undefined =
    typeof window !== "undefined"
      ? (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture
      : undefined;

  const supported =
    typeof window !== "undefined" &&
    !isMobile() &&
    !!dPiP &&
    typeof dPiP.requestWindow === "function";

  const [state, setState] = useState<SavedState>(() => load());

  const pipRef = useRef<Window | null>(null);
  const rootRef = useRef<ReactDOM.Root | null>(null);
  const rafRef = useRef<number | null>(null);

  // tick更新（rAF）
  useEffect(() => {
    const tick = () => {
      setState((prev) => {
        if (!prev.running || !prev.anchorEpoch) return prev;
        const now = Date.now();
        const delta = now - prev.anchorEpoch;

        const nextRemain = Math.max(0, prev.remainMs - delta);
        if (nextRemain <= 0) {
          const next: SavedState = { remainMs: 0, running: false, anchorEpoch: undefined };
          save(next);
          return next;
        }
        const next: SavedState = { remainMs: nextRemain, running: true, anchorEpoch: now };
        save(next);
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // PiPウィンドウのUI（Reactで直接描画）
  const renderPiP = () => {
    if (!pipRef.current) return;
    const doc = pipRef.current.document;
    doc.body.innerHTML = ""; // 初期化

    const container = doc.createElement("div");
    doc.body.appendChild(container);

    // 最低限のスタイル（終了時は背景点滅＆縁取りアニメで強調）
    const style = doc.createElement("style");
    style.textContent = `
      html,body { margin:0; padding:0; background:#111; color:#fff; font-family:system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial; }
      .wrap { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:14px; min-width:220px; }
      .big { font-size:32px; line-height:1; letter-spacing:0.5px; font-weight:700; }
      .row { display:flex; gap:8px; }
      button { font-size:12px; padding:6px 12px; border-radius:10px; border:1px solid #333; background:#222; color:#fff; }
      button:hover { background:#2a2a2a; }
      .done { animation: flash 1s infinite; box-shadow: 0 0 0 3px #ff5252 inset; }
      .done .big { text-shadow: 0 0 8px #ff9a9a; }
      .badge { font-size:11px; padding:2px 8px; border-radius:9999px; background:#333; }
      .done .badge { background:#ff5252; color:#111; font-weight:700; }
      @keyframes flash {
        0%   { background:#111; }
        50%  { background:#2a0000; }
        100% { background:#111; }
      }
    `;
    doc.head.appendChild(style);

    const PiPApp = () => {
      const [snap, setSnap] = useState<SavedState>(state);
      useEffect(() => setSnap(state), [state]);

      const start = () =>
        setState((p) => {
          if (p.running) return p;
          // 0秒なら5分に戻してから開始
          const base = p.remainMs <= 0 ? DURATION_MS : p.remainMs;
          const next: SavedState = { remainMs: base, running: true, anchorEpoch: Date.now() };
          save(next);
          return next;
        });

      const pause = () =>
        setState((p) => {
          if (!p.running || !p.anchorEpoch) return p;
          const delta = Date.now() - p.anchorEpoch;
          const nextRemain = Math.max(0, p.remainMs - delta);
          const next: SavedState = { remainMs: nextRemain, running: false, anchorEpoch: undefined };
          save(next);
          return next;
        });

      const reset = () => {
        const next: SavedState = { remainMs: DURATION_MS, running: false, anchorEpoch: undefined };
        save(next);
        setState(next);
      };

      const display = useMemo(() => mmss(snap.remainMs), [snap]);

      const done = snap.remainMs === 0;

      return (
        <div className={`wrap ${done ? "done" : ""}`}>
          <div className="badge">{done ? "TIME UP" : "5:00 TIMER"}</div>
          <div className="big" role="timer" aria-live="polite">{display}</div>
          <div className="row">
            {!snap.running ? (
              <button onClick={start}>{done ? "もう一度 5分" : "開始"}</button>
            ) : (
              <button onClick={pause}>一時停止</button>
            )}
            <button onClick={reset}>リセット</button>
          </div>
        </div>
      );
    };

    rootRef.current = ReactDOM.createRoot(container);
    rootRef.current.render(<PiPApp />);
  };

  const openPiP = async () => {
    if (!supported) {
      alert("この機能はPCのChromium系ブラウザでご利用ください。（Document Picture-in-Picture非対応）");
      return;
    }
    if (pipRef.current && !pipRef.current.closed) {
      try { pipRef.current.focus(); } catch {}
      return;
    }
    try {
      const pipWin = await dPiP!.requestWindow({
        width: 260,
        height: 160,
        disallowReturnToOpener: true,
      });
      pipRef.current = pipWin;
      renderPiP();

      // PiPを閉じたら参照を破棄
      pipWin.addEventListener("pagehide", () => {
        rootRef.current?.unmount();
        rootRef.current = null;
        pipRef.current = null;
      });
    } catch (e) {
      console.warn("[StudyTimer] openPiP failed:", e);
      alert("タイマー小ウィンドウの作成に失敗しました。ポップアップやPiPの許可設定をご確認ください。");
    }
  };

  // 勉強ページなどからの外部起動イベントを受ける
  useEffect(() => {
    const handler = () => openPiP();
    window.addEventListener("study-timer:open", handler);
    return () => window.removeEventListener("study-timer:open", handler);
  }, []);

  // 下部ドック（どの画面でも起動可能）
  if (!supported) return null;

  const minutesLeft = Math.max(0, Math.ceil(state.remainMs / 60000));

  return (
    <div
      aria-hidden
      className="fixed bottom-4 right-4 z-[1000] flex items-center gap-2 rounded-2xl border bg-white shadow-md px-3 py-2"
    >
      <button
        onClick={openPiP}
        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        title="PC限定：最前面の小ウィンドウで5分タイマーを表示"
      >
        ⏱ 5分タイマー
      </button>
      <span className="hidden sm:inline text-xs text-gray-600">
        残り {minutesLeft}分
      </span>
    </div>
  );
}
