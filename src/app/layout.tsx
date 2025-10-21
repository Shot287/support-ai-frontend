// src/app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";
import PushBootstrap from "@/features/push/PushBootstrap";
import Script from "next/script";

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

        {/* 退場時にセッションCookie(app_auth2)を削除 → 次回必ず /lock */}
        <Script id="logout-on-close" strategy="afterInteractive">
          {`
            (function () {
              const logout = () => {
                try {
                  // verify/route.ts の GET は app_auth2 を即削除（maxAge:0）
                  fetch('/api/auth/verify', { method: 'GET', cache: 'no-store', keepalive: true })
                    .catch(() => {});
                } catch (_) {}
              };

              // タブ/アプリを閉じる・バックグラウンドへ移るタイミングで実行
              window.addEventListener('pagehide', logout);
              document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'hidden') logout();
              });
            })();
          `}
        </Script>

        {/* 画面幅ガード（既存機能） */}
        <div className="app-width-guard mx-auto p-6">
          {children}
        </div>
      </body>
    </html>
  );
}
