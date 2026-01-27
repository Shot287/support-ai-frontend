// src/app/layout.tsx
import "./globals.css";
import "katex/dist/katex.min.css";

import type { ReactNode } from "react";
import PushBootstrap from "@/features/push/PushBootstrap";

// ★ クライアントコンポーネントを直接インポート（dynamic/ssr:falseは使わない）
// （現状このファイルでは未使用だが、既存の意図を壊さないため残す）
import StudyTimer from "@/features/study/StudyTimer";

export const metadata = {
  title: "サポートAI",
  description: "先延ばし対策・睡眠管理などの自己支援ツール",

  // ✅ PWAアイコン反映のために追加
  manifest: "/manifest.webmanifest",
  // （任意だが効く）メタアイコンも指定しておく
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh bg-white text-gray-900 antialiased overflow-x-hidden">
        {/* Service Worker 初期登録（既存機能） */}
        <PushBootstrap />

        {/* 画面幅ガード（既存機能） */}
        <div className="app-width-guard mx-auto p-6">{children}</div>
      </body>
    </html>
  );
}
