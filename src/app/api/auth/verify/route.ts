// src/app/api/auth/verify/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { password } = (await req.json()) as { password?: string };
    const appPassword = (process.env.APP_PASSWORD ?? "").trim();

    // パスワード一致チェック
    if (!password || password !== appPassword) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    // ✅ セッションCookieを発行（ブラウザ終了時に自動破棄）
    const res = NextResponse.json({ ok: true });
    res.cookies.set("app_auth2", "ok", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      // maxAge/expires を指定しない → セッションCookie扱い
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

/** 任意: ログアウト用 (GETアクセスでCookie削除) */
export async function GET() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("app_auth2", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0, // 即時削除
  });
  return res;
}
