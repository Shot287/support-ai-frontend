// src/app/api/_b/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";

/** Edge/Node どちらでもOKだが、Nodeの方が外部HTTPが安定しやすい */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Backend Origin（末尾スラッシュ除去して正規化） */
function getBackend(): string {
  const raw =
    process.env.BACKEND_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_BACKEND_ORIGIN?.trim() ||
    "https://support-ai-os6k.onrender.com";
  return raw.replace(/\/+$/, "");
}

/** サーバ側の認証用シークレット（Backend の Depends(auth_or_401) は x-token を要求） */
function getApiToken(): string {
  return (
    process.env.API_TOKEN?.trim() || // ← サーバ専用シークレット
    process.env.NEXT_PUBLIC_API_TOKEN?.trim() || // 保険（無ければ空）
    ""
  );
}

/** 透過させるだけで良いヘッダ */
const PASSTHROUGH_REQ_HEADERS = new Set([
  "content-type",
  "accept",
  "accept-language",
  "cache-control",
  "pragma",
  "x-token", // クライアントから来た場合は維持（ただしサーバ側シークレットで上書き）
]);

/** すべてのHTTPメソッドを同じハンドラにバインド */
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;

async function handler(
  req: NextRequest,
  ctx: { params: { path?: string[] } }
) {
  try {
    const backend = getBackend();
    const tail = (ctx.params.path ?? []).join("/");
    const search = req.nextUrl.search || "";
    const target = `${backend}/${tail}${search}`;

    // 転送ヘッダの組み立て
    const forwardHeaders = new Headers();
    req.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (PASSTHROUGH_REQ_HEADERS.has(lk)) forwardHeaders.set(k, v);
    });

    // サーバのシークレットで x-token を上書き（安全）
    const token = getApiToken();
    if (token) forwardHeaders.set("x-token", token);

    // Content-Type が無いケースは JSON を既定に
    if (!forwardHeaders.has("content-type")) {
      forwardHeaders.set("content-type", "application/json");
    }

    // Body は GET/HEAD 以外のみ
    const method = req.method.toUpperCase();
    const body =
      method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

    const res = await fetch(target, {
      method,
      headers: forwardHeaders,
      body,
      // @ts-ignore
      cache: "no-store",
      redirect: "manual",
    });

    // レスポンスを極力そのまま転送
    const headers = new Headers();
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() === "content-encoding") return; // 圧縮は Next/Vercel 側に任せる
      headers.set(k, v);
    });

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "proxy_failed", message: msg },
      { status: 502 }
    );
  }
}
