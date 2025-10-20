// src/lib/api.ts

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
if (!API_BASE) {
  // Vercel の Environment Variables に NEXT_PUBLIC_API_BASE を設定してください
  console.warn("NEXT_PUBLIC_API_BASE is not set");
}

// フロントから /push/* を叩く際に使う公開用トークン
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN || "";
if (!API_TOKEN) {
  console.warn("NEXT_PUBLIC_API_TOKEN is not set (push/* calls will fail)");
}

/** /push/* のときだけ x-token を自動付与し、必要に応じて Content-Type を補完 */
function withToken(path: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers || {});
  // /push/* エンドポイントは保護されているため、x-token を付与
  if (path.startsWith("/push") && API_TOKEN) {
    headers.set("x-token", API_TOKEN);
  }
  // body がある場合は JSON ヘッダーを補完
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  // GET 時も既定で application/json を付けたい場合は以下を有効化
  if (!headers.has("Content-Type") && (!init || !init.body)) {
    headers.set("Content-Type", "application/json");
  }
  return { ...init, headers };
}

/** 共通エラーハンドラ */
async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}: ${text}`);
  }
  // 204 No Content 等は as unknown as T で返す
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

/** GET */
export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    credentials: "omit", // Cookie を使わない想定
    cache: "no-store",
    ...withToken(path, init),
  });
  return handle<T>(res);
}

/** POST */
export async function apiPost<T>(
  path: string,
  body?: unknown,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    ...withToken(
      path,
      body !== undefined
        ? { ...init, body: JSON.stringify(body) }
        : { ...init }
    ),
  });
  return handle<T>(res);
}

/** PATCH（必要なら） */
export async function apiPatch<T>(
  path: string,
  body?: unknown,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    credentials: "omit",
    cache: "no-store",
    ...withToken(
      path,
      body !== undefined
        ? { ...init, body: JSON.stringify(body) }
        : { ...init }
    ),
  });
  return handle<T>(res);
}

/** DELETE（必要なら） */
export async function apiDelete<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    credentials: "omit",
    cache: "no-store",
    ...withToken(path, init),
  });
  return handle<T>(res);
}

/* ====== 既存・テスト用 ====== */

// テスト用エンドポイント
export function getEcho(q: string) {
  const search = new URLSearchParams({ q });
  return apiGet<{ echo: string }>(`/v1/echo?${search.toString()}`);
}

// 保護付き（x-token 明示版）
export function getPrivate(xToken: string) {
  return apiGet<{ secret: boolean; msg: string }>(`/v1/private`, {
    headers: { "x-token": xToken },
  });
}

/* ====== Web Push 用 ====== */

// VAPID 公開鍵の取得（自動で x-token が付く）
export function getVapidPublicKey() {
  return apiGet<{ publicKey: string }>(`/push/vapid-public-key`);
}

// 購読の保存（PushSubscription.toJSON() の結果をそのまま渡せばOK）
export function pushSubscribe(subscription: unknown) {
  return apiPost<{ ok: true }>(`/push/subscribe`, subscription);
}
