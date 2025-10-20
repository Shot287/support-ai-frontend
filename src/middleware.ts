// src/middleware.ts
import { NextResponse, type NextRequest } from "next/server";

// 完全一致で許可するパス
const PUBLIC_EXACT = new Set<string>([
  "/lock",
  "/api/auth/verify",
  "/api/auth/logout",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/sw.js",
]);

// 接頭辞一致で許可するパス（配下をすべて許可）
const PUBLIC_PREFIXES = [
  "/api/b/",   // ← 追加：バックエンドプロキシ(新)
  "/api/_b/",  // ← 旧プレフィックスも互換で許可
  "/_next/",   // Next.js の静的配信
  "/static/",
  "/public/",
  "/assets/",
  "/icon",
  "/apple-icon",
  "/android-chrome",
];

function shouldBypass(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // 公開パスはそのまま通す
  if (shouldBypass(pathname)) {
    return NextResponse.next();
  }

  // 認証クッキー（互換：x-lock-pass または app_auth）
  const ticket =
    req.cookies.get("x-lock-pass")?.value ??
    req.cookies.get("app_auth")?.value;

  if (ticket === "ok") {
    return NextResponse.next();
  }

  // 未認証 → /lock へ（元URLを next に付与）
  const url = req.nextUrl.clone();
  url.pathname = "/lock";
  url.searchParams.set("next", pathname + (search || ""));
  return NextResponse.redirect(url, 307);
}

// middleware の適用範囲（Next の内部静的ファイルなどは除外）
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest).*)",
  ],
};
