// src/middleware.ts
import { NextResponse, type NextRequest } from "next/server";

// 完全一致で許可するパス
const PUBLIC_EXACT = new Set<string>([
  "/lock",
  "/api/auth/verify",
  "/api/auth/logout",
  "/api/lock/unlock", // ← 追加：解除クッキー発行用API
  "/favicon.ico",
  "/manifest.webmanifest",
  "/sw.js",
]);

// 接頭辞一致で許可するパス（配下すべて）
const PUBLIC_PREFIXES = [
  "/api/b/",   // バックエンドプロキシ（新）
  "/api/_b/",  // 旧プレフィックス（互換で許可）
  "/api/lock/",  
  "/api/auth/",  
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

  // === Daily Lock 判定 ===
  // unlock_exp: epoch(ms) を値に持つ HttpOnly Cookie（当日末まで有効）
  const expStr = req.cookies.get("unlock_exp")?.value;
  const exp = expStr ? Number(expStr) : 0;
  const isUnlockedToday = Number.isFinite(exp) && Date.now() < exp;

  if (isUnlockedToday) {
    // 本日中は通過（ロック再表示しない）
    return NextResponse.next();
  }

  // 未解除 or 期限切れ → /lock へ（元URLを next に付与）
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
