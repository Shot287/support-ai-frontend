// src/middleware.ts
import { NextResponse, type NextRequest } from "next/server";

// 完全一致で許可するパス
const PUBLIC_EXACT = new Set<string>([
  "/lock",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/sw.js",
]);

// 接頭辞一致で許可するパス（配下すべて）
const PUBLIC_PREFIXES = [
  "/_next/",       // Next.js 静的配信
  "/static/",
  "/public/",
  "/assets/",
  "/icon",
  "/apple-icon",
  "/android-chrome",
];

function shouldBypass(pathname: string): boolean {
  // ✅ API は常に素通し（ここがポイント）
  if (pathname.startsWith("/api/")) return true;

  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // 公開パス / API はそのまま通す
  if (shouldBypass(pathname)) {
    return NextResponse.next();
  }

  // === Daily Lock 判定 ===
  const expStr = req.cookies.get("unlock_exp")?.value;
  const exp = expStr ? Number(expStr) : 0;
  const isUnlockedToday = Number.isFinite(exp) && Date.now() < exp;

  if (isUnlockedToday) {
    return NextResponse.next();
  }

  // 未解除 or 有効期限切れ → /lock へ（元URLを next に付与）
  const url = req.nextUrl.clone();
  url.pathname = "/lock";
  url.searchParams.set("next", pathname + (search || ""));
  return NextResponse.redirect(url, 307);
}

// 適用範囲
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest).*)",
  ],
};
