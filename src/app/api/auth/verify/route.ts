// src/app/api/auth/verify/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { password } = (await req.json()) as { password?: string };
    const appPassword = (process.env.APP_PASSWORD ?? "").trim();

    if (!password || password !== appPassword) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    // ✅ 1分だけ有効な認証Cookie（短寿命）
    const res = NextResponse.json({ ok: true });
    res.cookies.set("app_auth2", "ok", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60, // ← 1分
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

// 任意：ログアウト（Cookie即削除）
export async function GET() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("app_auth2", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
