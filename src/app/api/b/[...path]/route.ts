// src/app/api/_b/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";

/** Node.js 実行（Edgeだとbody転送で落ちやすい） */
export const runtime = "nodejs";
/** 透過プロキシは常に動的処理 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ======== 環境変数の取得 ======== */
const BACKEND =
  (process.env.BACKEND_ORIGIN ?? process.env.NEXT_PUBLIC_BACKEND_ORIGIN ?? "https://support-ai-os6k.onrender.com")
    .replace(/\/+$/, "");
const APP_KEY = (process.env.APP_KEY ?? "").trim();

/* ======== 転送時に通すヘッダ（小文字で比較） ======== */
const PASSTHROUGH = new Set([
  "content-type",
  "accept",
  "accept-language",
  "cache-control",
  "pragma",
  // クライアント由来のx-tokenは温存可（将来の互換用）。ただし今回の運用では未使用。
  "x-token",
]);

/* ======== すべてのメソッドを同一ハンドラで処理 ======== */
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;

/** プリフライトはここで完結（バックエンドに流さない） */
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 200, headers: corsHeaders(req) });
}

/* ======== 本体 ======== */
async function handler(req: NextRequest, ctx: { params: { path?: string[] } }) {
  try {
    if (!BACKEND) throw new Error("BACKEND_ORIGIN is not set");
    if (!APP_KEY) throw new Error("APP_KEY is not set on Vercel side");

    // 転送先URL
    const tail = (ctx.params.path ?? []).join("/");
    const url = new URL(req.url);
    const target = `${BACKEND}/${tail}${url.search}`;

    // 転送ヘッダ（不要・hop-by-hopを落とす）
    const fwd = new Headers();
    req.headers.forEach((v, k) => {
      const key = k.toLowerCase();
      if (PASSTHROUGH.has(key)) fwd.set(key, v);
    });

    // ここが最重要：共有シークレットを必ず付与
    fwd.set("x-app-key", APP_KEY);

    // hop-by-hop等削除（明示）
    ["host", "content-length", "connection", "accept-encoding"].forEach((h) => fwd.delete(h));

    // Body転送（GET/HEADは無し）
    const method = req.method.toUpperCase();
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await req.arrayBuffer();

    const res = await fetch(target, {
      method,
      headers: fwd,
      body,
      cache: "no-store",
      redirect: "manual",
    });

    // 応答ヘッダ（CORS付与＋不要系削除）
    const out = new Headers(corsHeaders(req));
    res.headers.forEach((v, k) => {
      const key = k.toLowerCase();
      if (key === "content-encoding" || key === "content-length" || key === "connection") return;
      out.set(k, v);
    });

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: out,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "proxy_failed", message: msg },
      { status: 502, headers: corsHeaders(req) }
    );
  }
}

/* ======== CORS（将来の拡張に備えて常に付与） ======== */
function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
    // x-app-key を明示的に許可
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, Accept-Language, Cache-Control, Pragma, X-Token, X-App-Key",
  };
}
