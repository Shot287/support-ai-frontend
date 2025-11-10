// src/features/study/instagram-follow-manager.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

// v2: 1ユーザー = 1行（フォロー中）＋「フォロワーかどうか」のフラグ
type FollowEntry = {
  id: ID;
  username: string;      // 表示用（入力された文字）
  usernameLower: string; // 比較用（小文字）
  isFollower: boolean;   // 相手もこちらをフォローしているか
  createdAt: number;
};

type StoreV2 = {
  entries: FollowEntry[];
  version: 2;
};

// v1: 旧版（テキスト2つで持っていた形）
type StoreV1 = {
  followingText: string;
  followersText: string;
  version: 1;
};

type StoreAny = StoreV1 | StoreV2;

const LOCAL_KEY = "instagram_follow_manager_v1";
const DOC_KEY = "instagram_follow_manager_v1";

function createDefaultStoreV2(): StoreV2 {
  return {
    entries: [],
    version: 2,
  };
}

function parseUserList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

// v1 → v2 マイグレーション
function migrate(raw: StoreAny | null | undefined): StoreV2 {
  if (!raw) return createDefaultStoreV2();

  if ((raw as StoreV2).version === 2) {
    const v2 = raw as StoreV2;
    return { ...v2, version: 2 };
  }

  const v1 = raw as StoreV1;
  const now = Date.now();
  const following = parseUserList(v1.followingText ?? "");
  const followers = parseUserList(v1.followersText ?? "").map((x) =>
    x.toLowerCase()
  );
  const followersSet = new Set(followers);

  const entries: FollowEntry[] = [];
  const seen = new Set<string>();

  for (const name of following) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    entries.push({
      id: `${now}-${entries.length}`,
      username: name,
      usernameLower: lower,
      isFollower: followersSet.has(lower),
      createdAt: now + entries.length,
    });
  }

  return { entries, version: 2 };
}

function loadLocal(): StoreV2 {
  try {
    if (typeof window === "undefined") return createDefaultStoreV2();
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createDefaultStoreV2();
    const parsed = JSON.parse(raw) as StoreAny;
    return migrate(parsed);
  } catch {
    return createDefaultStoreV2();
  }
}

function saveLocal(store: StoreV2) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
    }
  } catch {
    // 失敗しても無視
  }
}

// JSONインポート用の候補型
type ImportCandidate = {
  username: string;
  isFollower?: boolean;
};

// JSONの中身を柔らかく解釈して ImportCandidate[] にする
function parseImportedJson(data: unknown): ImportCandidate[] {
  let arr: unknown[] | null = null;

  if (Array.isArray(data)) {
    arr = data;
  } else if (data && typeof data === "object") {
    const obj = data as any;
    if (Array.isArray(obj.users)) arr = obj.users;
    else if (Array.isArray(obj.following)) arr = obj.following;
  }

  if (!arr) return [];

  const candidates: ImportCandidate[] = [];

  for (const item of arr) {
    if (typeof item === "string") {
      const name = item.trim();
      if (name) {
        candidates.push({ username: name });
      }
    } else if (item && typeof item === "object") {
      const o = item as any;
      const rawName =
        o.username ?? o.name ?? o.user ?? o.handle ?? "";
      const name = String(rawName).trim();
      if (!name) continue;
      const isFollower =
        !!o.isFollower || !!o.follower || !!o.mutual || !!o.is_following_back;
      candidates.push({ username: name, isFollower });
    }
  }

  return candidates;
}

export default function InstagramFollowManager() {
  const [store, setStore] = useState<StoreV2>(() => loadLocal());
  const storeRef = useRef(store);

  const [newUsername, setNewUsername] = useState("");

  // 新方式同期：変更のたびに ローカル + サーバ に保存
  useEffect(() => {
    storeRef.current = store;
    // ローカル
    saveLocal(store);
    // サーバ（user_docs）
    (async () => {
      try {
        await saveUserDoc<StoreV2>(DOC_KEY, store);
      } catch (e) {
        console.warn("[insta-follow-manager] saveUserDoc failed:", e);
      }
    })();
  }, [store]);

  // 初回マウント：サーバに何かあればそれを正とする
  useEffect(() => {
    (async () => {
      try {
        const remote = await loadUserDoc<StoreV2>(DOC_KEY);
        if (remote) {
          const migrated = migrate(remote as StoreAny);
          setStore(migrated);
          saveLocal(migrated);
          // v1 だった場合は v2 で上書き保存しておく
          if ((remote as any).version !== 2) {
            await saveUserDoc<StoreV2>(DOC_KEY, migrated);
          }
        } else {
          // サーバが空 → 現在のローカル状態をアップロード
          await saveUserDoc<StoreV2>(DOC_KEY, storeRef.current);
        }
      } catch (e) {
        console.warn("[insta-follow-manager] loadUserDoc failed:", e);
      }
    })();
  }, []);

  // 表示用：作成順に並べる
  const entries = useMemo(
    () => [...store.entries].sort((a, b) => a.createdAt - b.createdAt),
    [store.entries]
  );

  const totalFollowing = entries.length;
  const totalFollowers = entries.filter((e) => e.isFollower).length;
  const notFollowedBack = entries.filter((e) => !e.isFollower);

  const addEntry = () => {
    const name = newUsername.trim();
    if (!name) return;
    const lower = name.toLowerCase();

    setStore((s) => {
      if (s.entries.some((e) => e.usernameLower === lower)) {
        // すでに登録済みなら何もしない
        return s;
      }
      const now = Date.now();
      const entry: FollowEntry = {
        id: `${now}-${Math.random().toString(36).slice(2)}`,
        username: name,
        usernameLower: lower,
        isFollower: false,
        createdAt: now,
      };
      return { ...s, entries: [...s.entries, entry] };
    });
    setNewUsername("");
  };

  const toggleFollower = (id: ID) => {
    setStore((s) => ({
      ...s,
      entries: s.entries.map((e) =>
        e.id === id ? { ...e, isFollower: !e.isFollower } : e
      ),
    }));
  };

  const removeEntry = (id: ID) => {
    setStore((s) => ({
      ...s,
      entries: s.entries.filter((e) => e.id !== id),
    }));
  };

  // JSONインポート本体
  const importFromCandidates = (candidates: ImportCandidate[]) => {
    if (!candidates.length) {
      alert("有効なユーザーがJSONから見つかりませんでした。形式を確認してください。");
      return;
    }

    const prev = storeRef.current;
    const existing = new Set(prev.entries.map((e) => e.usernameLower));
    const newEntries = [...prev.entries];
    let added = 0;

    const nowBase = Date.now();

    for (const c of candidates) {
      const name = c.username.trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      if (existing.has(lower)) continue;
      existing.add(lower);

      const entry: FollowEntry = {
        id: `${nowBase}-${Math.random().toString(36).slice(2)}`,
        username: name,
        usernameLower: lower,
        isFollower: !!c.isFollower,
        createdAt: nowBase + added,
      };
      newEntries.push(entry);
      added++;
    }

    if (added === 0) {
      alert("すべて既存のユーザーと重複していたため、新規追加はありませんでした。");
      return;
    }

    setStore({ ...prev, entries: newEntries });
    alert(`${added}件のユーザーをフォローリストに追加しました。`);
  };

  const handleImportFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result ?? "");
        const json = JSON.parse(raw);
        const candidates = parseImportedJson(json);
        importFromCandidates(candidates);
      } catch (e) {
        console.warn("[insta-follow-manager] import json parse error:", e);
        alert("JSONの読み込みに失敗しました。ファイルの形式を確認してください。");
      }
    };
    reader.readAsText(file);
  };

  const copyNotFollowedBack = () => {
    const text = notFollowedBack.map((e) => e.username).join("\n");
    if (!text) {
      alert("フォローしているのにフォローされていないユーザーはいません。");
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        alert("クリップボードにコピーしました。Instagram 上でフォロー解除に使ってください。");
      })
      .catch(() => {
        alert("コピーに失敗しました。");
      });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      {/* 左側：フォローリストの編集 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h1 className="text-xl font-bold mb-4">Instagram相互フォロー管理</h1>
        <p className="text-sm text-gray-600 mb-4">
          フォローしているアカウントだけを登録しておき、
          各行の「フォロワー」ボタンで「相手も自分をフォローしている」かを記録します。
          差分リストを見ながら、Instagram 上でフォロー解除していく想定です。
        </p>

        {/* 追加フォーム */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addEntry();
              }
            }}
            className="flex-1 min-w-[180px] rounded-xl border px-3 py-2 text-sm"
            placeholder="ユーザーネームを入力（例: user_name）"
          />
          <button
            type="button"
            onClick={addEntry}
            className="rounded-xl bg-black px-4 py-2 text-sm text-white"
          >
            追加
          </button>
        </div>

        {/* JSONインポート */}
        <div className="mb-4 border-t pt-3">
          <h3 className="text-sm font-semibold mb-1">JSONインポート（フォロー中ユーザーをまとめて追加）</h3>
          <p className="text-xs text-gray-500 mb-2">
            例）メモ帳で <code>["user_a","user_b"]</code>{" "}
            または{" "}
            <code>[{"{ \"username\": \"user_a\" }"}, ...]</code>{" "}
            のような JSON を作成して保存し、そのファイルを選択してください。
          </p>
          <label className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs cursor-pointer hover:bg-gray-50">
            JSONファイルを選択
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => handleImportFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {/* 集計情報 */}
        <div className="mb-3 text-sm text-gray-700 space-y-1">
          <p>
            フォロー数: <span className="font-semibold">{totalFollowing}</span> 件
          </p>
          <p>
            フォロワー数（登録済みの中でフォロワーにチェックを付けた数）:
            <span className="font-semibold"> {totalFollowers}</span> 件
          </p>
          <p>
            「片側フォロー（こちら→相手のみ）」:
            <span className="font-semibold"> {notFollowedBack.length}</span> 件
          </p>
        </div>

        {/* フォロー中リスト */}
        {entries.length === 0 ? (
          <p className="text-sm text-gray-500 mt-2">
            まだフォローリストが登録されていません。
            上の入力欄にユーザーネームを入れて「追加」するか、JSONインポートを試してください。
          </p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto border rounded-2xl mt-2">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr className="text-left">
                  <th className="px-3 py-2 w-[40%]">ユーザーネーム</th>
                  <th className="px-3 py-2 w-[30%]">フォロワー</th>
                  <th className="px-3 py-2 w-[30%]">操作</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="px-3 py-2 font-mono break-all">{e.username}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => toggleFollower(e.id)}
                        className={
                          "rounded-xl px-3 py-1.5 text-xs border " +
                          (e.isFollower
                            ? "bg-green-600 text-white border-green-600"
                            : "bg-white text-gray-700 hover:bg-gray-50")
                        }
                      >
                        {e.isFollower ? "フォロワー ✔" : "フォロワーにする"}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => removeEntry(e.id)}
                        className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 右側：差分結果とコピー用リスト */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">差分結果</h2>

        <div className="mb-4 text-sm text-gray-700 space-y-1">
          <p>
            相互フォロー:
            <span className="font-semibold"> {totalFollowers}</span> 件
          </p>
          <p>
            「こちらがフォローしているのにフォローされていない」:
            <span className="font-semibold"> {notFollowedBack.length}</span> 件
          </p>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">
              こちらがフォローしているのにフォローされていないユーザー
            </h3>
            <button
              type="button"
              onClick={copyNotFollowedBack}
              className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
            >
              リストをコピー
            </button>
          </div>
          {notFollowedBack.length === 0 ? (
            <p className="text-xs text-gray-500">
              現時点では、全員が相互フォローの状態です 🎉
            </p>
          ) : (
            <ul className="max-h-56 overflow-y-auto text-sm border rounded-xl px-3 py-2 space-y-1 font-mono bg-gray-50">
              {notFollowedBack.map((e) => (
                <li key={e.id}>{e.username}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-gray-500">
            ※ このリストをコピーして、Instagram アプリ / Web のフォロー一覧を見ながら
            フォロー解除に使ってください。このツール自体からInstagramを直接操作することはありません。
          </p>
        </div>
      </section>
    </div>
  );
}
