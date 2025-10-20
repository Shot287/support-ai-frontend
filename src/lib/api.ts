// src/lib/api.ts

// ==== 環境変数 ====
// API 基本パスは Next.js 側プロキシに固定
const API_BASE = '/api/b';
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN || "";

if (!API_TOKEN) console.warn("NEXT_PUBLIC_API_TOKEN is not set (push/* & nudge/* calls will require it)");

// ==== ユーティリティ ====
const joinUrl = (base: string, path: string) => {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
};

function needsJsonBody(body: unknown): boolean {
  if (body == null) return false;
  if (typeof FormData !== "undefined" && body instanceof FormData) return false;
  if (typeof Blob !== "undefined" && body instanceof Blob) return false;
  return true;
}

/**
 * /push/* と /nudge/* のとき x-token を自動付与（方式A）
 */
function withDefaults(path: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers || {});
  const needsToken = (path.startsWith("/push") || path.startsWith("/nudge")) && !!API_TOKEN;

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

/** タイムアウト付き fetch（デフォルト 15 秒） */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number }
) {
  const { timeoutMs = 15000, ...rest } = init || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
      finalBody = body as BodyInit;
    }
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(url, { ...opts, method, body: finalBody });
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    const reason = name === "AbortError" ? "timeout" : "network";
    throw new Error(`API ${reason} error while ${method} ${path}: ${String(err)}`);
  }

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
    throw new Error(`API ${method} ${path} -> ${res.status} ${res.statusText}: ${detail}`);
  }

  if (res.status === 204) return undefined as unknown as T;

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
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
