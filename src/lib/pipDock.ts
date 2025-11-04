// src/lib/pipDock.ts
export type Panel = {
  id: string;
  render: (root: HTMLElement) => () => void; // unmount を返す
};

export type PiPDock = {
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

export function getOrCreateDock(): PiPDock | null {
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

      // PiPクローズ時：全パネルを破棄してシングルトン解除
      w.addEventListener("pagehide", () => {
        dock.panels.forEach(({ dispose }) => dispose());
        dock.panels.clear();
        window.__pipDock = undefined;
      });

      return w;
    },
    addPanel: async (panel) => {
      const w = await dock.ensureOpen();
      const host = w.document.getElementById(dock.containerId)!;

      // 同IDがあれば差し替え
      dock.removePanel(panel.id);

      const el = w.document.createElement("div");
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
