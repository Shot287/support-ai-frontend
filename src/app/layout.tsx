// src/app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";
import PushBootstrap from "@/features/push/PushBootstrap";
import dynamic from "next/dynamic";

// ★ PC限定：最前面タイマー（Document Picture-in-Picture）起動ドックを遅延ロード
//    - SSR不要のため ssr:false
//    - 非対応環境（モバイル/非Chromium）では内部で非表示
const StudyTimer = dynamic(() => import("@/features/study/StudyTimer"), { ssr: false });

export const metadata = {
  title: "サポートAI",
  description: "先延ばし対策・睡眠管理などの自己支援ツール",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh bg-white text-gray-900 antialiased overflow-x-hidden">
        {/* Service Worker 初期登録（既存機能） */}
        <PushBootstrap />

        {/* 画面幅ガード（既存機能） */}
        <div className="app-width-guard mx-auto p-6">
          {children}
        </div>

        {/* ★ PC限定タイマーの常駐ドック（どのページでも起動可能） */}
        <StudyTimer />
      </body>
    </html>
  );
}
