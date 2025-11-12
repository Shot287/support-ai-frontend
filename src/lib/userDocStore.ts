// frontend/src/lib/userDocStore.ts
//
// 「1ユーザー1ドキュメント」の簡易同期ユーティリティ。
// バックエンド main.py の /api/docs/{doc_key} を、
// Next.js のプロキシ /api/b/... 経由で叩きます。

const USER_ID = "demo"; // ここを変えない限り、PC/スマホ/iPad で同じ文書を共有

// backend 側のエンドポイントは /api/docs/{doc_key}
// → Next.js 側では /api/b/api/docs/{doc_key}?user_id=demo になる
function buildUrl(docKey: string): string {
  const basePath = `/api/b/api/docs/${encodeURIComponent(docKey)}`;
  const qs = `user_id=${encodeURIComponent(USER_ID)}`;
  return `${basePath}?${qs}`;
}

/**
 * サーバからドキュメントを読み込む。
 * 見つからない場合は null を返す。
 */
export async function loadUserDoc<T>(docKey: string): Promise<T | null> {
  // SSR 中は何もしない（クライアントだけで実行）
  if (typeof window === "undefined") return null;

  const res = await fetch(buildUrl(docKey), {
    method: "GET",
    headers: {
      accept: "application/json",
    },
    cache: "no-store", // 常に最新を取りに行く
  });

  if (!res.ok) {
    // 404などはここで気づける
    throw new Error(`loadUserDoc failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    ok: boolean;
    data: T | null;
    updated_at: number | null;
  };

  if (!json.ok) {
    throw new Error("loadUserDoc: backend returned ok=false");
  }

  return json.data;
}

/**
 * サーバにドキュメントを保存する（Last-Write-Wins）。
 */
export async function saveUserDoc<T>(docKey: string, doc: T): Promise<void> {
  if (typeof window === "undefined") return;

  const res = await fetch(buildUrl(docKey), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(doc),
  });

  if (!res.ok) {
    throw new Error(`saveUserDoc failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { ok: boolean; updated_at?: number };
  if (!json.ok) {
    throw new Error("saveUserDoc: backend returned ok=false");
  }
}
