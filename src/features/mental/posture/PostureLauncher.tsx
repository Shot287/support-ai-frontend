"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export default function PostureLauncher() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)").matches;
    const touch = "ontouchstart" in window || (navigator as any).maxTouchPoints > 0;
    setIsDesktop(wide && !touch);
  }, []);

  const hasDocPiP = useMemo(() => {
    const dip = (window as any).documentPictureInPicture;
    return !!dip && typeof dip.requestWindow === "function";
  }, []);

  // 推奨：Document Picture-in-Picture（常に前面）
  const openDocPiP = async () => {
    try {
      const dip = (window as any).documentPictureInPicture;
      if (!dip || typeof dip.requestWindow !== "function") {
        openPopup();
        return;
      }

      const pipWin: Window = await dip.requestWindow({ width: 240, height: 160 });

      const mount = pipWin.document.createElement("div");
      pipWin.document.body.appendChild(mount);

      const style = pipWin.document.createElement("style");
      style.textContent = `
        html,body{margin:0;padding:6px;background:#fff;}
        *{font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Helvetica, Arial;}
      `;
      pipWin.document.head.appendChild(style);

      const [{ createRoot }, { default: Widget }] = await Promise.all([
        import("react-dom/client"),
        import("./PostureMiniWidget"),
      ]);
      const root = createRoot(mount);
      root.render(<Widget />);
      pipWin.addEventListener("unload", () => root.unmount());
    } catch {
      openPopup();
    }
  };

  // 従来ポップアップ
  const openPopup = () => {
    const w = 240, h = 160;
    const y = Math.max(0, Math.round((window.outerHeight - h) / 3));
    const x = Math.max(0, Math.round((window.outerWidth - w) / 2));
    const features = [
      "popup=yes","noopener","noreferrer","menubar=no","location=no","toolbar=no",
      "status=no","scrollbars=no","resizable=yes",`width=${w}`,`height=${h}`,`left=${x}`,`top=${y}`,
    ].join(",");
    window.open("/mental/posture/mini", "posture-mini", features);
  };

  const openRecommended = () => (hasDocPiP ? openDocPiP() : openPopup());

  return (
    <main className="max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">背筋（最前面ミニウィンドウ）</h1>
      <p className="text-gray-600">Doc-PiP（対応ブラウザ）なら常に前面。非対応なら小ポップアップで開きます。</p>

      <div className="rounded-2xl border p-5 space-y-4">
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={openRecommended}
            disabled={!isDesktop}
            className="rounded-xl px-4 py-2 bg-black text-white disabled:opacity-40"
            title={isDesktop ? "" : "PC環境でご利用ください"}
          >
            ミニウィンドウを開く（推奨）
          </button>
          {!hasDocPiP && (
            <span className="text-sm text-gray-500 self-center">
              ※お使いのブラウザではDoc-PiP非対応のため、従来ポップアップで開きます。
            </span>
          )}
        </div>

        <div className="text-sm text-gray-500">※ブラウザのポップアップ/PiPの許可が必要です。</div>

        <div>
          <Link href="/mental/posture/logs" className="text-blue-600 hover:underline">
            記録を表示する
          </Link>
        </div>
      </div>
    </main>
  );
}
