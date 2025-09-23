// src/lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE!;
if (!API_BASE) {
  // ないときに気づけるように
  // Vercel の Environment Variables に NEXT_PUBLIC_API_BASE を設定してください
  console.warn("NEXT_PUBLIC_API_BASE is not set");
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    // CORSでCookie使わない想定。必要なら include に
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store", // プレビュー検証時は都度取得
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// テスト用エンドポイント
export function getEcho(q: string) {
  const search = new URLSearchParams({ q });
  return apiGet<{ echo: string }>(`/v1/echo?${search.toString()}`);
}

// 保護付き（x-token ヘッダー送信）
export function getPrivate(xToken: string) {
  return apiGet<{ secret: boolean; msg: string }>(`/v1/private`, {
    headers: { "x-token": xToken },
  });
}
