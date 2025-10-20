// src/app/api/_b/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBackend(): string {
  const raw =
    process.env.BACKEND_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_BACKEND_ORIGIN?.trim() ||
    "https://support-ai-os6k.onrender.com";
  return raw.replace(/\/+$/, "");
}

function getApiToken(): string {
  return (
    process.env.API_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_API_TOKEN?.trim() ||
    ""
  );
}

const PASSTHROUGH_REQ_HEADERS = new Set([
  "content-type",
  "accept",
  "accept-language",
  "cache-control",
  "pragma",
  "x-token",
]);

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

    const forwardHeaders = new Headers();
    req.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (PASSTHROUGH_REQ_HEADERS.has(lk)) forwardHeaders.set(k, v);
    });

    const token = getApiToken();
    if (token) forwardHeaders.set("x-token", token);

    if (!forwardHeaders.has("content-type")) {
      forwardHeaders.set("content-type", "application/json");
    }

    const method = req.method.toUpperCase();
    const body =
      method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

    const res = await fetch(target, {
      method,
      headers: forwardHeaders,
      body,
      cache: "no-store",
      redirect: "manual",
    });

    const headers = new Headers();
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() === "content-encoding") return;
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
