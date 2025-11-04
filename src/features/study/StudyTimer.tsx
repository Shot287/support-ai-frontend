// src/features/study/StudyTimer.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as ReactDOM from "react-dom/client";

/**
 * PC限定 学習タイマー（Document Picture-in-Picture）
 * - 1分 / 5分 を切替できるカウントダウン（無音／0で視覚演出）
 * - 共有PiPドックに「study」パネルとして登録（背筋タイマーと同居可能）
 * - 親は setInterval + Date.now 差分で正確に減算、PiPは localStorage ポーリングで表示追従
 * - 常駐ドック + "study-timer:open" で起動
 */

const STORAGE_KEY = "study_timer:v2_simple5min"; // 既存キーを流用（後方互換）
const ONE_MIN = 1 * 60 * 1000;
const FIVE_MIN = 5 * 60 * 1000;

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
        height: opts?.height ?? 190,
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
        .seg { display:flex; gap:6px; justify-content:center; }
        .seg > button[aria-pressed="true"] { background:#444; font-weight:700; }
        .seg > button:disabled { opacity:.5; }
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
  presetMin: 1 | 5; // ★ 追加：プリセット（1 or 5）
};

const DEFAULT: SavedState = {
  remainMs: FIVE_MIN,
  running: false,
  presetMin: 5,
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
    const obj = JSON.parse(raw) as Partial<SavedState>;
    const merged: SavedState = {
      remainMs: typeof obj.remainMs === "number" ? obj.remainMs : DEFAULT.remainMs,
      running: !!obj.running,
      anchorEpoch: obj.anchorEpoch,
      presetMin: (obj as any).presetMin === 1 ? 1 : 5, // 後方互換（未保存なら5）
    };

    // 復元
    if (merged.running && merged.anchorEpoch) {
      const delta = Date.now() - merged.anchorEpoch;
      merged.remainMs = Math.max(0, merged.remainMs - delta);
      if (merged.remainMs <= 0) {
        merged.running = false;
        merged.anchorEpoch = undefined;
      } else {
        merged.anchorEpoch = Date.now();
      }
    }
    // remain を上限（選択プリセット）に丸める
    const cap = merged.presetMin === 1 ? ONE_MIN : FIVE_MIN;
    if (merged.remainMs > cap) merged.remainMs = cap;

    return merged;
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
          const next: SavedState = { ...prev, remainMs: 0, running: false, anchorEpoch: undefined };
          save(next);
          return next;
        }
        const next: SavedState = { ...prev, remainMs: nextRemain, running: true, anchorEpoch: now };
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

        const durationCap = snap.presetMin === 1 ? ONE_MIN : FIVE_MIN;

        const start = () =>
          setState((p) => {
            if (p.running) return p;
            const cap = p.presetMin === 1 ? ONE_MIN : FIVE_MIN;
            const base = p.remainMs <= 0 || p.remainMs > cap ? cap : p.remainMs;
            const next: SavedState = { ...p, remainMs: base, running: true, anchorEpoch: Date.now() };
            save(next);
            return next;
          });

        const pause = () =>
          setState((p) => {
            if (!p.running || !p.anchorEpoch) return p;
            const delta = Date.now() - p.anchorEpoch;
            const nextRemain = Math.max(0, p.remainMs - delta);
            const next: SavedState = { ...p, remainMs: nextRemain, running: false, anchorEpoch: undefined };
            save(next);
            return next;
          });

        const reset = () =>
          setState((p) => {
            const cap = p.presetMin === 1 ? ONE_MIN : FIVE_MIN;
            const next: SavedState = { ...p, remainMs: cap, running: false, anchorEpoch: undefined };
            save(next);
            return next;
          });

        // ★ プリセット切替（稼働中は変更不可、停止中は残り時間を即プリセットに合わせる）
        const setPreset = (min: 1 | 5) =>
          setState((p) => {
            if (p.running) return p; // シンプル運用：走行中は切替不可
            const cap = min === 1 ? ONE_MIN : FIVE_MIN;
            const next: SavedState = { ...p, presetMin: min, remainMs: cap, running: false, anchorEpoch: undefined };
            save(next);
            return next;
          });

        const display = useMemo(() => mmss(snap.remainMs), [snap.remainMs]);
        const done = snap.remainMs === 0;

        return (
          <div className={`timer ${done ? "done" : ""}`}>
            <div className="timer-badge">
              {done ? "TIME UP" : `${snap.presetMin}:00 TIMER`}
            </div>

            {/* プリセット切替（停止中のみ有効） */}
            <div className="seg" style={{ marginBottom: 6 }}>
              <button
                onClick={() => setPreset(1)}
                aria-pressed={snap.presetMin === 1}
                disabled={snap.running || snap.presetMin === 1}
                title={snap.running ? "一時停止すると切替できます" : "1分タイマーに切替"}
              >
                1分
              </button>
              <button
                onClick={() => setPreset(5)}
                aria-pressed={snap.presetMin === 5}
                disabled={snap.running || snap.presetMin === 5}
                title={snap.running ? "一時停止すると切替できます" : "5分タイマーに切替"}
              >
                5分
              </button>
            </div>

            <div className="big" role="timer" aria-live="polite">{display}</div>
            <div className="row" style={{ marginTop: 6 }}>
              {!snap.running ? (
                <button onClick={start}>{done ? `もう一度 ${snap.presetMin}分` : "開始"}</button>
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
    await dock.ensureOpen({ width: 230, height: 190 });
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
        title="PC限定：最前面の小ウィンドウ（共有ドック）で学習タイマーを表示"
      >
        ⏱ 学習タイマー（1/5分）
      </button>
      <span className="hidden sm:inline text-xs text-gray-600">残り {minutesLeft}分</span>
    </div>
  );
}
