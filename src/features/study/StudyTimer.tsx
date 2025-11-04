// src/features/study/StudyTimer.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as ReactDOM from "react-dom/client";

/**
 * PC限定 学習タイマー（Document Picture-in-Picture）
 * - 5分固定カウントダウン（無音／0で視覚演出）
 * - 共有PiPドックに「study」パネルとして登録（背筋タイマーと同居可能）
 * - 親は setInterval + Date.now 差分で正確に減算、PiPは localStorage ポーリングで表示追従
 * - 常駐ドック + "study-timer:open" で起動
 */

const DURATION_MS = 5 * 60 * 1000;
const STORAGE_KEY = "study_timer:v2_simple5min";

// ===== 共有PiPドック（シングルトン） ============================
type Panel = {
  id: string;
  render: (root: HTMLElement) => () => void; // unmount を返す
};
type PiPDock = {
  win: Window | null;
  containerId: string;
  panels: Map<string, { rootEl: HTMLElement; dispose: () => void }>;
  ensureOpen: (opts?: { width?: number; height?: number }) => Promise<Window>;
  addPanel: (panel: Panel) => Promise<void>;
  removePanel: (id: string) => void;
};

declare global {
  interface Window {
    __pipDock?: PiPDock;
    documentPictureInPicture?: {
      requestWindow: (options?: {
        width?: number;
        height?: number;
        disallowReturnToOpener?: boolean;
      }) => Promise<Window>;
    };
  }
}

function getOrCreateDock(): PiPDock | null {
  if (typeof window === "undefined") return null;
  if (window.__pipDock) return window.__pipDock;

  const dPiP = window.documentPictureInPicture;
  if (!dPiP) return null;

  const dock: PiPDock = {
    win: null,
    containerId: "__pip-dock-root",
    panels: new Map(),
    ensureOpen: async (opts) => {
      if (dock.win && !dock.win.closed) return dock.win;
      const w = await dPiP.requestWindow({
        width: opts?.width ?? 230,
        height: opts?.height ?? 170,
        disallowReturnToOpener: true,
      });
      dock.win = w;

      const doc = w.document;
      doc.body.innerHTML = "";
      const style = doc.createElement("style");
      style.textContent = `
        html,body { margin:0; padding:0; background:#0e0e0e; color:#fff; font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial; }
        #${dock.containerId} { display:flex; flex-direction:column; gap:8px; padding:8px; min-width:170px; }
        .panel { border:1px solid #2d2d2d; border-radius:10px; padding:8px; background:#161616; }
        .done { animation: flash 1s infinite; box-shadow: 0 0 0 2px #ff5252 inset; }
        .timer-badge { font-size:10px; padding:1px 8px; border-radius:9999px; background:#333; display:inline-block; margin-bottom:4px; }
        .done .timer-badge { background:#ff5252; color:#111; font-weight:700; }
        .big { font-size:26px; line-height:1; letter-spacing:0.5px; font-weight:700; text-align:center; }
        .row { display:flex; gap:6px; justify-content:center; }
        button { font-size:11px; padding:5px 10px; border-radius:10px; border:1px solid #333; background:#222; color:#fff; }
        button:hover { background:#2a2a2a; }
        @keyframes flash { 0%{background:#161616;} 50%{background:#2a0000;} 100%{background:#161616;} }
      `;
      doc.head.appendChild(style);

      const root = doc.createElement("div");
      root.id = dock.containerId;
      doc.body.appendChild(root);

      w.addEventListener("pagehide", () => {
        dock.panels.forEach(({ dispose }) => dispose());
        dock.panels.clear();
        window.__pipDock = undefined;
      });

      return w;
    },
    addPanel: async (panel) => {
      const w = await dock.ensureOpen();
      const doc = w.document;
      const host = doc.getElementById(dock.containerId)!;

      // 同IDがあれば差し替え
      dock.removePanel(panel.id);

      const el = doc.createElement("div");
      el.className = "panel";
      host.appendChild(el);

      const dispose = panel.render(el);
      dock.panels.set(panel.id, { rootEl: el, dispose });
    },
    removePanel: (id) => {
      const cur = dock.panels.get(id);
      if (!cur) return;
      try { cur.dispose(); } catch {}
      cur.rootEl.remove();
      dock.panels.delete(id);
    },
  };

  window.__pipDock = dock;
  return dock;
}
// ===============================================================

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
  typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

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
    // 復元
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

export default function StudyTimer() {
  const supported =
    typeof window !== "undefined" &&
    !isMobile() &&
    !!window.documentPictureInPicture &&
    typeof window.documentPictureInPicture.requestWindow === "function";

  const [state, setState] = useState<SavedState>(() => load());
  const intervalRef = useRef<number | null>(null);

  // 親側tick（バックグラウンドでも進む）
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
    };
    intervalRef.current = window.setInterval(tick, 250);
    return () => {
      if (intervalRef.current != null) window.clearInterval(intervalRef.current);
    };
  }, []);

  // 学習タイマーパネル（共有ドックに載せるUI）
  const getStudyPanel = (): Panel => ({
    id: "study",
    render: (mountEl: HTMLElement) => {
      const PiPPanel = () => {
        const [snap, setSnap] = useState<SavedState>(() => load());

        // PiP側は localStorage をポーリングして最新値を表示
        useEffect(() => {
          const id = window.setInterval(() => {
            try {
              const raw = localStorage.getItem(STORAGE_KEY);
              if (!raw) return;
              setSnap(JSON.parse(raw) as SavedState);
            } catch {}
          }, 250);
          return () => window.clearInterval(id);
        }, []);

        const start = () =>
          setState((p) => {
            if (p.running) return p;
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

        const display = useMemo(() => mmss(snap.remainMs), [snap.remainMs]);
        const done = snap.remainMs === 0;

        return (
          <div className={`timer ${done ? "done" : ""}`}>
            <div className="timer-badge">{done ? "TIME UP" : "5:00 TIMER"}</div>
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

      const root = ReactDOM.createRoot(mountEl);
      root.render(<PiPPanel />);
      return () => root.unmount();
    },
  });

  // 共有ドックに study パネルを追加して起動
  const openPiPWithDock = async () => {
    const dock = getOrCreateDock();
    if (!dock) {
      alert("この機能はPCのChromium系ブラウザでご利用ください。（Document Picture-in-Picture非対応）");
      return;
    }
    await dock.ensureOpen({ width: 230, height: 170 });
    await dock.addPanel(getStudyPanel());
  };

  // 外部起動イベント
  useEffect(() => {
    const handler = () => openPiPWithDock();
    window.addEventListener("study-timer:open", handler);
    return () => window.removeEventListener("study-timer:open", handler);
  }, []);

  // 右下ドック（ボタン）
  if (!supported) return null;

  const minutesLeft = Math.max(0, Math.ceil(state.remainMs / 60000));

  return (
    <div
      aria-hidden
      className="fixed bottom-4 right-4 z-[1000] flex items-center gap-2 rounded-2xl border bg-white shadow-md px-3 py-2"
    >
      <button
        onClick={openPiPWithDock}
        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        title="PC限定：最前面の小ウィンドウ（共有ドック）で5分タイマーを表示"
      >
        ⏱ 5分タイマー
      </button>
      <span className="hidden sm:inline text-xs text-gray-600">残り {minutesLeft}分</span>
    </div>
  );
}
