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
      <body className="min-h-dvh bg-white text-gray-900 antialiased">
        {/* Service Worker を初期登録（クライアント側で一度だけ実行） */}
        <PushBootstrap />
        <div className="mx-auto max-w-4xl p-6">{children}</div>
      </body>
    </html>
  );
}
