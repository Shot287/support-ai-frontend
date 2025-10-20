// src/app/api/auth/verify/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { password } = (await req.json()) as { password?: string };
    const ok = Boolean(password) && password === process.env.APP_PASSWORD;

    if (!ok) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    // 合格証クッキー（値は固定の "ok"、秘密はサーバだけが知る）
    res.cookies.set('x-lock-pass', 'ok', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 12, // 12h
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
