import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

/**
 * パスワード検証のみ（Cookie は発行しない）
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
