// src/app/api/_b/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";

/** ここを Node.js 実行に固定（Edge だと body 取り回しでハマりやすい） */
export const runtime = "nodejs";
/** どんな状況でも常にサーバーで処理（静的化させない） */
export const dynamic = "force-dynamic";
export const revalidate = 0;

function backendOrigin(): string {
  const raw =
    process.env.BACKEND_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_BACKEND_ORIGIN?.trim() ||
    "https://support-ai-os6k.onrender.com";
  return raw.replace(/\/+$/, "");
}
function apiToken(): string {
  return (
    process.env.API_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_API_TOKEN?.trim() ||
    ""
  );
}

/** そのまま通すヘッダー */
const PASSTHROUGH = new Set([
  "content-type",
  "accept",
  "accept-language",
  "cache-control",
  "pragma",
  "x-token", // クライアント指定があれば維持
]);

/** すべてのメソッドをこのハンドラで受ける */
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
/** CORS/プリフライトはここで即完結させる（バックエンドへ転送しない） */
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders(req),
  });
}

async function handler(req: NextRequest, ctx: { params: { path?: string[] } }) {
  try {
    // 転送先 URL を生成
    const tail = (ctx.params.path ?? []).join("/");
    const url = new URL(req.url);
    const target = `${backendOrigin()}/${tail}${url.search}`;

    // 転送するヘッダ
    const fwd = new Headers();
    req.headers.forEach((v, k) => {
      if (PASSTHROUGH.has(k.toLowerCase())) fwd.set(k, v);
    });
    // 共有トークンを必ず付与
    const token = apiToken();
    if (token && !fwd.has("x-token")) fwd.set("x-token", token);

    // ボディ（GET/HEAD はなし、それ以外はそのまま透過）
    const method = req.method.toUpperCase();
    const body =
      method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

    // サーバー間フェッチ
    const res = await fetch(target, {
      method,
      headers: fwd,
      body,
      cache: "no-store",
      redirect: "manual",
    });

    // レスポンスヘッダを複製（圧縮系は除外）
    const outHeaders = new Headers(corsHeaders(req));
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() === "content-encoding") return;
      outHeaders.set(k, v);
    });

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "proxy_failed", message: msg },
      { status: 502, headers: corsHeaders(req) }
    );
  }
}

/** 同一オリジンだが、将来に向けて一応 CORS を無害化（OPTIONS 200など） */
function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, Accept-Language, Cache-Control, Pragma, X-Token",
  };
}
