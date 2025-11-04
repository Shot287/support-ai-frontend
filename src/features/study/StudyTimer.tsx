// src/features/study/StudyTimer.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as ReactDOM from "react-dom/client";

/**
 * PC限定のフローティング学習タイマー（Document Picture-in-Picture）
 * - 小ウィンドウは常に最前面
 * - アプリ内のページ遷移中も持続（RootLayoutに常駐）
 * - 同期不要（localStorageのみ）
 */

type Mode = "countdown" | "stopwatch";

const STORAGE_KEY = "study_timer:v1";

type SavedState = {
  mode: Mode;
  remainMs: number;     // countdown用：残りミリ秒
  elapsedMs: number;    // stopwatch用：経過ミリ秒
  running: boolean;
  anchorEpoch?: number; // running中の起点（performance.nowの代わりにDate.now基準）
  label?: string;
};

const DEFAULT: SavedState = {
  mode: "countdown",
  remainMs: 25 * 60 * 1000,
  elapsedMs: 0,
  running: false,
  label: "Study",
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
    return { ...DEFAULT, ...obj };
  } catch {
    return DEFAULT;
  }
}

function save(s: SavedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

export default function StudyTimer() {
  const supported =
    typeof window !== "undefined" &&
    !isMobile() &&
    "documentPictureInPicture" in window &&
    typeof (window as any).documentPictureInPicture?.requestWindow === "function";

  const [state, setState] = useState<SavedState>(() => {
    const s = load();
    // running復元処理（ブラウザ再読込後）
    if (s.running && s.anchorEpoch) {
      const delta = Date.now() - s.anchorEpoch;
      if (s.mode === "countdown") {
        s.remainMs = Math.max(0, s.remainMs - delta);
        if (s.remainMs <= 0) {
          s.running = false;
          s.anchorEpoch = undefined;
        } else {
          s.anchorEpoch = Date.now();
        }
      } else {
        s.elapsedMs = Math.max(0, s.elapsedMs + delta);
        s.anchorEpoch = Date.now();
      }
    }
    return s;
  });

  const pipRef = useRef<Window | null>(null);
  const rootRef = useRef<ReactDOM.Root | null>(null);
  const rafRef = useRef<number | null>(null);

  // 音（終了ビープ）
  const beepRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    beepRef.current = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA="
    );
  }, []);

  // tick更新
  useEffect(() => {
    const tick = () => {
      setState((prev) => {
        if (!prev.running || !prev.anchorEpoch) return prev;
        const now = Date.now();
        const delta = now - prev.anchorEpoch;

        if (prev.mode === "countdown") {
          const nextRemain = Math.max(0, prev.remainMs - delta);
          if (nextRemain <= 0) {
            // 終了
            if (beepRef.current) {
              try { beepRef.current.play().catch(() => {}); } catch {}
            }
            const next: SavedState = {
              ...prev,
              remainMs: 0,
              running: false,
              anchorEpoch: undefined,
            };
            save(next);
            return next;
          }
          const next: SavedState = {
            ...prev,
            remainMs: nextRemain,
            anchorEpoch: now,
          };
          save(next);
          return next;
        } else {
          const next: SavedState = {
            ...prev,
            elapsedMs: prev.elapsedMs + delta,
            anchorEpoch: now,
          };
          save(next);
          return next;
        }
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

    // 最低限のスタイル
    const style = doc.createElement("style");
    style.textContent = `
      html,body { margin:0; padding:0; background:#111; color:#fff; font-family:system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial; }
      .wrap { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:12px; min-width:220px; }
      .big { font-size:28px; line-height:1; letter-spacing:0.5px; }
      .label { font-size:12px; color:#bbb; }
      .row { display:flex; gap:6px; }
      button { font-size:12px; padding:6px 10px; border-radius:10px; border:1px solid #333; background:#222; color:#fff; }
      button:hover { background:#2a2a2a; }
      input[type="text"] { width:120px; font-size:12px; padding:6px 8px; border-radius:10px; border:1px solid #333; background:#1a1a1a; color:#fff; }
      select { font-size:12px; padding:6px 8px; border-radius:10px; border:1px solid #333; background:#1a1a1a; color:#fff; }
    `;
    doc.head.appendChild(style);

    const PiPApp = () => {
      const [snap, setSnap] = useState<SavedState>(state);

      // 親→子の状態同期
      useEffect(() => setSnap(state), [state]);

      const start = () =>
        setState((p) => {
          if (p.running) return p;
          const next = { ...p, running: true, anchorEpoch: Date.now() };
          save(next);
          return next;
        });

      const pause = () =>
        setState((p) => {
          if (!p.running || !p.anchorEpoch) return p;
          const delta = Date.now() - p.anchorEpoch;
          if (p.mode === "countdown") {
            const nextRemain = Math.max(0, p.remainMs - delta);
            const next = { ...p, running: false, anchorEpoch: undefined, remainMs: nextRemain };
            save(next);
            return next;
          } else {
            const next = { ...p, running: false, anchorEpoch: undefined, elapsedMs: p.elapsedMs + delta };
            save(next);
            return next;
          }
        });

      const reset = () =>
        setState((p) => {
          const next: SavedState =
            p.mode === "countdown"
              ? { ...p, running: false, anchorEpoch: undefined, remainMs: 25 * 60 * 1000 }
              : { ...p, running: false, anchorEpoch: undefined, elapsedMs: 0 };
          save(next);
          return next;
        });

      const setPreset = (min: number) =>
        setState((p) => {
          const next = { ...p, mode: "countdown" as const, running: false, anchorEpoch: undefined, remainMs: min * 60 * 1000 };
          save(next);
          return next;
        });

      const switchMode = () =>
        setState((p) => {
          const next: SavedState =
            p.mode === "countdown"
              ? { ...p, mode: "stopwatch", running: false, anchorEpoch: undefined, elapsedMs: 0 }
              : { ...p, mode: "countdown", running: false, anchorEpoch: undefined, remainMs: 25 * 60 * 1000 };
          save(next);
          return next;
        });

      const onChangeLabel = (v: string) =>
        setState((p) => {
          const next = { ...p, label: v.slice(0, 32) };
          save(next);
          return next;
        });

      const display = useMemo(() => {
        return snap.mode === "countdown" ? mmss(snap.remainMs) : mmss(snap.elapsedMs);
      }, [snap]);

      return (
        <div className="wrap">
          <div className="label">{snap.label || "Study"}</div>
          <div className="big" role="timer" aria-live="polite">{display}</div>
          <div className="row">
            {!snap.running ? (
              <button onClick={start}>開始</button>
            ) : (
              <button onClick={pause}>一時停止</button>
            )}
            <button onClick={reset}>リセット</button>
            <button onClick={switchMode}>{snap.mode === "countdown" ? "→ ストップウォッチ" : "→ カウントダウン"}</button>
          </div>
          {snap.mode === "countdown" && (
            <div className="row">
              <select
                onChange={(e) => setPreset(Number(e.target.value))}
                value={-1}
              >
                <option value={-1} disabled>プリセット</option>
                <option value={25}>25分</option>
                <option value={50}>50分</option>
                <option value={90}>90分</option>
              </select>
            </div>
          )}
          <div className="row">
            <input
              type="text"
              placeholder="ラベル（任意）"
              value={snap.label || ""}
              onChange={(e) => onChangeLabel(e.target.value)}
            />
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
      // @ts-ignore
      const pipWin: Window = await (window as any).documentPictureInPicture.requestWindow({
        width: 280,
        height: 180,
        disallowReturnToOpener: true,
      });
      pipRef.current = pipWin;
      renderPiP();

      // 親が閉じる/遷移してもPiPは維持されるが、PiPを閉じたら参照を破棄
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

  // 下部ドック（どの画面でも起動可能）
  if (!supported) return null;

  const minutesLeft =
    state.mode === "countdown" ? Math.ceil(state.remainMs / 60000) : Math.floor(state.elapsedMs / 60000);

  return (
    <div
      aria-hidden
      className="fixed bottom-4 right-4 z-[1000] flex items-center gap-2 rounded-2xl border bg-white shadow-md px-3 py-2"
    >
      <button
        onClick={openPiP}
        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        title="PC限定：最前面の小ウィンドウでタイマーを表示"
      >
        ⏱ 学習タイマー
      </button>
      <span className="hidden sm:inline text-xs text-gray-600">
        {state.mode === "countdown" ? "残り" : "経過"} {minutesLeft}分
      </span>
    </div>
  );
}
