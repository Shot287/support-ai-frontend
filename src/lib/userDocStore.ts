// frontend/src/lib/userDocStore.ts
//
// 「1ユーザー1ドキュメント」の簡易同期ユーティリティ（ETag/If-Match対応版）
// - GET時にサーバが返す ETag を保存
// - PUT時に保存済みETagを If-Match で送信（未取得時は '*' = 新規作成の意）
// - 412(Precondition Failed) を受けたら最新を再取得→ETag更新→1回だけ自動再試行
//
// バックエンド main.py の /api/docs/{doc_key} を、Next.js のプロキシ /api/b/... 経由で叩きます。

const USER_ID = "demo"; // ここを変えない限り、PC/スマホ/iPad で同じ文書を共有

// backend 側のエンドポイントは /api/docs/{doc_key}
// → Next.js 側では /api/b/api/docs/{doc_key}?user_id=demo になる
function buildUrl(docKey: string): string {
  const basePath = `/api/b/api/docs/${encodeURIComponent(docKey)}`;
  const qs = `user_id=${encodeURIComponent(USER_ID)}`;
  return `${basePath}?${qs}`;
}

/* =========================
 * ETag キャッシュ
 * ========================= */
type ETagMap = Record<string, string>; // key: `${USER_ID}::${docKey}` → ETag文字列
const ETAG_LS_KEY = "userdoc_etags_v1";

// メモリキャッシュ（タブ内）
let etagMem: ETagMap | null = null;

function loadETagMap(): ETagMap {
  if (etagMem) return etagMem;
  try {
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem(ETAG_LS_KEY);
      etagMem = raw ? (JSON.parse(raw) as ETagMap) : {};
      return etagMem!;
    }
  } catch {
    // ignore
  }
  etagMem = {};
  return etagMem;
}

function saveETagMap(map: ETagMap) {
  etagMem = map;
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(ETAG_LS_KEY, JSON.stringify(map));
    }
  } catch {
    // ignore
  }
}

function etagKey(docKey: string) {
  return `${USER_ID}::${docKey}`;
}

function getETag(docKey: string): string | undefined {
  const map = loadETagMap();
  return map[etagKey(docKey)];
}

function setETag(docKey: string, etag: string | null | undefined) {
  const map = loadETagMap();
  const k = etagKey(docKey);
  if (etag) map[k] = etag;
  else delete map[k];
  saveETagMap(map);
}

/* =========================
 * API
 * ========================= */

/**
 * サーバからドキュメントを読み込む。
 * 見つからない場合は null を返す。
 * 成功時は ETag を更新。
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
    throw new Error(`loadUserDoc failed: ${res.status} ${res.statusText}`);
  }

  // ETagを保存（存在する場合）
  const etag = res.headers.get("ETag");
  if (etag) setETag(docKey, etag);

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
 * サーバにドキュメントを保存する（条件付き更新）。
 * - 既存ETagあり → If-Match: <ETag> で送信
 * - 既存ETagなし → If-Match: * で送信（新規作成の意図）
 * - 412を受けたら最新をGETしてETag更新→1回だけ再保存を試みる
 */
export async function saveUserDoc<T>(docKey: string, doc: T): Promise<void> {
  if (typeof window === "undefined") return;

  // 1回分の送信を行う内部関数
  const tryPut = async (): Promise<Response> => {
    const currentETag = getETag(docKey);
    const res = await fetch(buildUrl(docKey), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // 既存あり: If-Match に ETag、未知: '*'（新規作成を許可）
        "if-match": currentETag ?? "*",
      },
      body: JSON.stringify(doc),
    });
    return res;
  };

  // 1回目
  let res = await tryPut();

  // 412なら最新取得→ETag更新→再試行（衝突解消）
  if (res.status === 412) {
    // 最新を取得（ETagも更新される）
    await loadUserDoc<unknown>(docKey);
    // リトライ（もう一度だけ）
    res = await tryPut();
  }

  if (!res.ok) {
    throw new Error(`saveUserDoc failed: ${res.status} ${res.statusText}`);
  }

  // 成功時は新しいETagで更新
  const newETag = res.headers.get("ETag");
  if (newETag) setETag(docKey, newETag);

  const json = (await res.json()) as { ok: boolean; updated_at?: number };
  if (!json.ok) {
    throw new Error("saveUserDoc: backend returned ok=false");
  }
}
