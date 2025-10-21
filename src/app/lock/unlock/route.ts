import { NextResponse } from "next/server";
import { msToMaxAge } from "@/lib/dailyLock";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const exp = Number((body as any)?.exp);
  if (!Number.isFinite(exp)) {
    return NextResponse.json({ ok: false, message: "bad request" }, { status: 400 });
  }

  const now = Date.now();
  const deltaMs = Math.max(0, exp - now);
  const maxAge = msToMaxAge(deltaMs);
  const expiresStr = new Date(exp).toUTCString();

  // ✅ Secure属性を「https環境のときだけ」付与
  const isHttps = req.headers.get("x-forwarded-proto") === "https" || req.url.startsWith("https://");

  const cookie = [
    `unlock_exp=${exp}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    `Expires=${expiresStr}`,
    isHttps ? "Secure" : undefined,
  ]
    .filter(Boolean)
    .join("; ");

  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", cookie);
  return res;
}
