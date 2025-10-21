import { NextResponse } from "next/server";
import { msToMaxAge } from "@/lib/dailyLock";

/**
 * POST /api/lock/unlock
 * body: { exp: number }  // epoch(ms) - 端末ローカルの「次の0時」
 * 成功時に HttpOnly Cookie "unlock_exp" を当日末まで有効で発行します。
 */
export async function POST(req: Request) {
  // body 取得（失敗時は null）
  const body = await req.json().catch(() => null as unknown);

  // exp を number に正規化（string が来ても Number() で数値化）
  const exp = Number((body as any)?.exp);

  // 型・範囲チェック（ここを通過したら exp は number と確定）
  if (!Number.isFinite(exp)) {
    return new NextResponse(JSON.stringify({ ok: false, message: "bad request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = Date.now();
  const deltaMs = Math.max(0, exp - now);
  const maxAge = msToMaxAge(deltaMs);
  const expiresStr = new Date(exp).toUTCString(); // ← exp は number に確定済み

  // cookie attributes
  const cookie = [
    `unlock_exp=${exp}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    `Expires=${expiresStr}`, // 互換のため Expires も付与
    process.env.NODE_ENV === "production" ? "Secure" : undefined,
  ]
    .filter(Boolean)
    .join("; ");

  const res = new NextResponse(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  res.headers.append("Set-Cookie", cookie);
  return res;
}
