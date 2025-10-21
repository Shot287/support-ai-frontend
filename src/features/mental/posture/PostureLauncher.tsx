"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function PostureLauncher() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)").matches;
    const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setIsDesktop(wide && !touch);
  }, []);

  const openMini = () => {
    const w = 320, h = 220;
    const y = Math.max(0, Math.round((window.outerHeight - h) / 3));
    const x = Math.max(0, Math.round((window.outerWidth - w) / 2));
    const features = `popup=yes,noopener,noreferrer,menubar=no,location=no,toolbar=no,status=no,scrollbars=no,resizable=yes,width=${w},height=${h},left=${x},top=${y}`;
    window.open("/mental/posture/mini", "posture-mini", features);
  };

  return (
    <main className="max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">背筋（PCミニウィンドウ）</h1>
      <p className="text-gray-600">小ウィンドウに「背筋」とタイマーを表示。開始〜終了で記録。</p>

      <div className="rounded-2xl border p-5 space-y-4">
        <button
          onClick={openMini}
          disabled={!isDesktop}
          className="rounded-xl px-4 py-2 bg-black text-white disabled:opacity-40"
          title={isDesktop ? "" : "PC環境でご利用ください"}
        >
          背筋ミニウィンドウを開く（PC）
        </button>

        <div className="text-sm text-gray-500">※ポップアップを許可してください。</div>

        <div>
          <Link href="/mental/posture/logs" className="text-blue-600 hover:underline">
            記録を表示する
          </Link>
        </div>
      </div>
    </main>
  );
}
