// src/app/api/_b/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";

const BACKEND =
  process.env.BACKEND_ORIGIN?.trim() ||
  process.env.NEXT_PUBLIC_BACKEND_ORIGIN?.trim() || // 保険
  "https://support-ai-os6k.onrender.com";           // 最後の保険

const APP_KEY = (process.env.APP_KEY || "").trim();

// そのまま透過したいヘッダ（必要最低限）
const passthroughReqHeaders = [
  "content-type",
  "accept",
  "accept-language",
  "cache-control",
  "pragma",
  "x-token",               // 任意：クライアントから来た場合は維持
];

// どのメソッドでも同じハンドラで扱う
export async function GET(req: NextRequest, ctx: { params: { path: string[] } }) {
  return handle(req, ctx);
}
export async function POST(req: NextRequest, ctx: { params: { path: string[] } }) {
  return handle(req, ctx);
}
export async function PATCH(req: NextRequest, ctx: { params: { path: string[] } }) {
  return handle(req, ctx);
}
export async function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) {
  return handle(req, ctx);
}
export async function OPTIONS(req: NextRequest, ctx: { params: { path: string[] } }) {
  return handle(req, ctx);
}

async function handle(req: NextRequest, ctx: { params: { path: string[] } }) {
  // /api/_b/** → BACKEND/** へ転送
  const tail = (ctx.params.path || []).join("/");
  const url = new URL(req.url);
  const target = `${BACKEND}/${tail}${url.search}`;

  // リクエストヘッダ組み立て
  const headers: Record<string, string> = {};
  for (const k of passthroughReqHeaders) {
    const v = req.headers.get(k);
    if (v) headers[k] = v;
  }
  // 共有シークレットを必ず付与（バックエンドの middleware で検証される）
  if (APP_KEY) headers["x-app-key"] = APP_KEY;

  // Body
  let body: BodyInit | undefined = undefined;
  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    // バイナリも扱えるよう ArrayBuffer で受ける
    const buf = await req.arrayBuffer();
    body = buf;
  }

  // 転送
  const res = await fetch(target, {
    method: req.method,
    headers,
    body,
    // keepalive は任意
  });

  // レスポンスヘッダ（Content-Type などは透過）
  const resHeaders = new Headers();
  for (const [k, v] of res.headers.entries()) {
    if (k.toLowerCase() === "content-encoding") continue; // 圧縮はNext側で再適用される
    resHeaders.set(k, v);
  }

  // ステータス/本文をそのまま返す
  const buf = await res.arrayBuffer();
  return new NextResponse(buf, { status: res.status, headers: resHeaders });
}
