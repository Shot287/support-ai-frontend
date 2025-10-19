// src/app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";
import PushBootstrap from "@/features/push/PushBootstrap";

export const metadata = {
  title: "サポートAI",
  description: "先延ばし対策・睡眠管理などの自己支援ツール",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh bg-white text-gray-900 antialiased overflow-x-hidden">
        {/* Service Worker を初期登録（クライアント側で一度だけ実行） */}
        <PushBootstrap />

        {/* ✅ 横スクロールを廃止し、画面幅にフィット */}
        <div className="app-width-guard mx-auto p-6">
          {children}
        </div>
      </body>
    </html>
  );
}
