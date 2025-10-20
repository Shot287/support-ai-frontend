// src/app/api/b/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BACKEND =
  (process.env.BACKEND_ORIGIN ?? process.env.NEXT_PUBLIC_BACKEND_ORIGIN ?? "https://support-ai-os6k.onrender.com")
    .replace(/\/+$/, "");
const APP_KEY = (process.env.APP_KEY ?? "").trim();

const PASSTHROUGH = new Set([
  "content-type",
  "accept",
  "accept-language",
  "cache-control",
  "pragma",
  "x-token", // 互換維持（今回の運用では未使用）
]);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 200, headers: corsHeaders(req) });
}

async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> } // ★ Next.js 15: params は Promise
) {
  try {
    if (!BACKEND) throw new Error("BACKEND_ORIGIN is not set");
    if (!APP_KEY) throw new Error("APP_KEY is not set on Vercel side");

    // ★ ここで await が必要
    const { path = [] } = await ctx.params;
    const url = new URL(req.url);
    const tail = (path ?? []).join("/");
    const target = `${BACKEND}/${tail}${url.search}`;

    const fwd = new Headers();
    req.headers.forEach((v, k) => {
      const key = k.toLowerCase();
      if (PASSTHROUGH.has(key)) fwd.set(key, v);
    });

    // 共有シークレットを必ず付与
    fwd.set("x-app-key", APP_KEY);

    ["host", "content-length", "connection", "accept-encoding"].forEach((h) => fwd.delete(h));

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

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, Accept-Language, Cache-Control, Pragma, X-Token, X-App-Key",
  };
}
