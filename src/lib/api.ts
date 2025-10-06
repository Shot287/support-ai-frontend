// src/lib/api.ts

// ==== 環境変数 ====
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN || "";

if (!API_BASE)  console.warn("NEXT_PUBLIC_API_BASE is not set");
if (!API_TOKEN) console.warn("NEXT_PUBLIC_API_TOKEN is not set (push/* & nudge/* calls will require it)");

// ==== ユーティリティ ====
const joinUrl = (base: string, path: string) =>
  `${base}${path.startsWith("/") ? "" : "/"}${path}`;

function needsJsonBody(body: unknown): boolean {
  if (body == null) return false;
  // FormData/Blob などは Content-Type 自動付与に任せる
  if (typeof FormData !== "undefined" && body instanceof FormData) return false;
  if (typeof Blob !== "undefined" && body instanceof Blob) return false;
  return true; // それ以外は JSON 化
}

/**
 * /push/* と /nudge/* のとき x-token を自動付与（方式Aの最小修正）
 * 方式B（/api/proxy）へ移行する場合は、ここでの付与は不要
 */
function withDefaults(path: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers || {});
  const needsToken =
    (path.startsWith("/push") || path.startsWith("/nudge")) && !!API_TOKEN;

  if (needsToken && !headers.has("x-token")) {
    headers.set("x-token", API_TOKEN);
  }

  return {
    credentials: "omit",
    cache: "no-store",
    ...init,
    headers,
  };
}

/** 共通フェッチ */
async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  init?: RequestInit
): Promise<T> {
  const url = joinUrl(API_BASE, path);
  const opts = withDefaults(path, init);

  // Body の取り扱い（JSON だけ Content-Type を付与）
  let finalBody: BodyInit | undefined = undefined;
  if (body !== undefined) {
    if (needsJsonBody(body)) {
      (opts.headers as Headers).set("Content-Type", "application/json");
      finalBody = JSON.stringify(body);
    } else {
      // FormData/Blob など
      finalBody = body as BodyInit;
    }
  }

  const res = await fetch(url, { ...opts, method, body: finalBody });

  // エラーハンドリング（JSON を優先、なければ text）
  if (!res.ok) {
    let detail = "";
    try {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        detail = JSON.stringify(await res.json());
      } else {
        detail = await res.text();
      }
    } catch {
      /* noop */
    }
    throw new Error(`API ${res.status} ${res.statusText}: ${detail}`);
  }

  if (res.status === 204) return undefined as unknown as T;

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    // 予期せぬ非JSONレスポンス
    const text = await res.text();
    return (text as unknown) as T;
  }
  return (await res.json()) as T;
}

// ==== パブリック API ====
export function apiGet<T>(path: string, init?: RequestInit) {
  return request<T>("GET", path, undefined, init);
}

export function apiPost<T>(path: string, body?: unknown, init?: RequestInit) {
  return request<T>("POST", path, body, init);
}

export function apiPatch<T>(path: string, body?: unknown, init?: RequestInit) {
  return request<T>("PATCH", path, body, init);
}

export function apiDelete<T>(path: string, init?: RequestInit) {
  return request<T>("DELETE", path, undefined, init);
}

// ==== 既存・テスト用 ====
export function getEcho(q: string) {
  const search = new URLSearchParams({ q });
  return apiGet<{ echo: string }>(`/v1/echo?${search.toString()}`);
}

export function getPrivate(xToken: string) {
  return apiGet<{ secret: boolean; msg: string }>(`/v1/private`, {
    headers: { "x-token": xToken },
  });
}

// ==== Web Push 用 ====
export function getVapidPublicKey() {
  return apiGet<{ publicKey: string }>(`/push/vapid-public-key`);
}

export function pushSubscribe(subscription: unknown) {
  return apiPost<{ ok: true }>(`/push/subscribe`, subscription);
}

// 任意：手動ディスパッチをフロントから叩く場合
export function pushDispatch() {
  return apiPost<{ ok: boolean; mode: "running" | "stopped"; last_ping_at?: string }>(
    `/push/dispatch`
  );
}
