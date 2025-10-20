import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/lock',
  '/api/auth/verify',
  '/api/auth/logout',
  '/favicon.ico',
  '/manifest.webmanifest',
  '/sw.js',
  '/_next',   // Nextの静的配信
  '/static',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 公開パスはそのまま通す
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 認証クッキー確認
  const authed = req.cookies.get('app_auth')?.value === 'ok';
  if (!authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/lock';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// middleware の適用範囲
export const config = {
  matcher: ['/((?!_next|static).*)'],
};
