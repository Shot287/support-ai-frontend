// src/app/api/auth/verify/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * パスワードの妥当性のみを検証するAPI。
 * Cookieは発行しません（ロック可否は /api/lock/unlock の unlock_exp で制御）。
 */
export async function POST(req: Request) {
  try {
    const { password } = (await req.json()) as { password?: string };
    const appPassword = (process.env.APP_PASSWORD ?? "").trim();

    if (!password || password !== appPassword) {
      return NextResponse.json({ ok: false, message: "invalid password" }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, message: "bad request" }, { status: 400 });
  }
}

// ※ 旧: GET でのログアウト（Cookie削除）は廃止しました。
//   併用していた app_auth2 Cookie も発行しません。
