// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';

const LOCK_PATH = '/lock';
const BYPASS_PREFIXES = [
  '/api/_b/',            // ← バックエンドへのプロキシは認証バイパス
  '/_next/', '/favicon.ico', '/sw.js', '/manifest.webmanifest',
  '/public/', '/assets/', '/icon', '/apple-icon', '/android-chrome'
];

function isBypassPath(path: string): boolean {
  return BYPASS_PREFIXES.some(p => path.startsWith(p));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // バイパス対象はそのまま通す
  if (isBypassPath(pathname)) return NextResponse.next();

  // すでに /lock は通す
  if (pathname.startsWith(LOCK_PATH)) return NextResponse.next();

  // ここからパスワードゲートの本体
  const pass = req.cookies.get('x-lock-pass')?.value || '';
  const ok = pass && pass === process.env.NEXT_PUBLIC_LOCK_PASS; // 例：環境変数に設定

  if (ok) return NextResponse.next();

  // 認証されていない場合は lock に 307 で遷移（元 URL を next に渡す）
  const url = req.nextUrl.clone();
  url.pathname = LOCK_PATH;
  url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url, 307);
}

// “どこに効かせるか” の指定。/api/_b/ は除外できるように広めにかける
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest).*)',
  ],
};
