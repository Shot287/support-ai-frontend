// src/app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";
import PushBootstrap from "@/features/push/PushBootstrap";

// ★ クライアントコンポーネントを直接インポート（dynamic/ssr:falseは使わない）
import StudyTimer from "@/features/study/StudyTimer";

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
