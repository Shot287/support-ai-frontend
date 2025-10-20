import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({}));
  const ok =
    typeof password === 'string' &&
    password.length > 0 &&
    password === process.env.APP_PASSWORD;

  if (!ok) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('app_auth', 'ok', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30日
  });
  return res;
}
