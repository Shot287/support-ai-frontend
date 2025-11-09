// frontend/src/lib/userDocStore.ts

export type UserId = string;

/** バックエンドから返ってくる想定の型 */
export type UserDocRecord<T> = {
  user_id: UserId;
  doc_key: string;
  data: T;
  updated_at: number; // UNIX ms
};

/** 共通エラー型 */
export class UserDocError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "UserDocError";
    this.status = status;
  }
}

/**
 * ドキュメントを読み込む
 * 存在しない場合は null を返す
 */
export async function loadUserDoc<T>(
  docKey: string,
  userId: UserId = "demo"
): Promise<T | null> {
  const url = `/api/b/user-docs/${encodeURIComponent(docKey)}?user_id=${encodeURIComponent(userId)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new UserDocError(`Failed to load doc "${docKey}"`, res.status);

  const json = await res.json();
  if (typeof json === "object" && json && "data" in json) {
    return (json as { data: T }).data;
  }
  return null;
}

/**
 * ドキュメントを保存（上書き）
 */
export async function saveUserDoc<T>(
  docKey: string,
  data: T,
  userId: UserId = "demo"
): Promise<void> {
  const url = `/api/b/user-docs/${encodeURIComponent(docKey)}?user_id=${encodeURIComponent(userId)}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ data }),
  });

  if (!res.ok) throw new UserDocError(`Failed to save doc "${docKey}"`, res.status);
}

/**
 * 現在のドキュメントを読み込んでから部分更新する
 */
export async function updateUserDoc<T>(
  docKey: string,
  updater: (current: T | null) => T,
  userId: UserId = "demo"
): Promise<T> {
  const current = await loadUserDoc<T>(docKey, userId);
  const next = updater(current);
  await saveUserDoc<T>(docKey, next, userId);
  return next;
}
