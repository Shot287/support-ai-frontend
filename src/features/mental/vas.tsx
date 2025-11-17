// src/features/mental/vas.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";

type ID = string;

export type VasFolder = {
  id: ID;
  name: string;
  createdAt: number;
};

export type VasItem = {
  id: ID;
  folderId: ID;
  title: string;   // 一言タイトル（例：ゼミ、家族との会話、レジ対応など）
  detail: string;  // 補足メモ（任意）
  level: number;   // ストレスレベル 0〜100
  createdAt: number;
  updatedAt: number;
};

type Store = {
  folders: VasFolder[];
  items: VasItem[];
  version: 1;
};

const LOCAL_KEY = "mental_vas_v1";
const DOC_KEY = "mental_vas_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

// ===== ローカル読み込み / 保存 =====
function loadLocal(): Store {
  try {
    if (typeof window === "undefined") {
      return {
        folders: [],
        items: [],
        version: 1,
      };
    }
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) {
      return {
        folders: [],
        items: [],
        version: 1,
      };
    }
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || typeof parsed !== "object") {
      return { folders: [], items: [], version: 1 };
    }
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      items: Array.isArray(parsed.items) ? parsed.items : [],
      version: 1,
    };
  } catch {
    return {
      folders: [],
      items: [],
      version: 1,
    };
  }
}

function saveLocal(store: Store) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
    }
  } catch {
    // noop
  }
}

// 日付表示フォーマット
function fmtDateTime(t: number) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(t));
}

type SortKey = "createdAt" | "level";
type SortOrder = "asc" | "desc";

// ===== 本体コンポーネント =====
export default function Vas() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // フォルダー関連
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<ID | null>(null);

  // ストレス追加フォーム
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [level, setLevel] = useState(50);

  // 並び替え
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // ローカルへは即時保存（サーバー反映はホームのボタン経由のみ）
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // ---- 手動同期の合図を購読（manual-sync.ts に一本化） ----
  useEffect(() => {
    const unsubscribe = registerManualSync({
      // 📥 取得（クラウド→ローカル）
      pull: async () => {
        try {
          const remote = await loadUserDoc<Store>(DOC_KEY);
          if (remote && remote.version === 1) {
            setStore(remote);
            saveLocal(remote);
          }
        } catch (e) {
          console.warn("[mental-vas] manual PULL failed:", e);
        }
      },
      // ☁ アップロード（ローカル→クラウド）
      push: async () => {
        try {
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        } catch (e) {
          console.warn("[mental-vas] manual PUSH failed:", e);
        }
      },
      // ⚠ RESET: since 未使用なので特別な処理は不要
      reset: async () => {
        /* no-op */
      },
    });
    return unsubscribe;
  }, []);

  // ===== フォルダー追加 =====
  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) {
      alert("フォルダー名を入力してください。（例：大学／家／職場など）");
      return;
    }
    const now = Date.now();
    const f: VasFolder = {
      id: uid(),
      name,
      createdAt: now,
    };
    setStore((s) => ({
      ...s,
      folders: [...s.folders, f],
    }));
    setNewFolderName("");
    // まだ何も選択していない場合は、このフォルダーを選択状態にする
    setSelectedFolderId((prev) => prev ?? f.id);
  };

  const removeFolder = (id: ID) => {
    if (
      !confirm(
        "このフォルダーと、その中の全てのストレス項目を削除します。よろしいですか？"
      )
    )
      return;
    setStore((s) => ({
      ...s,
      folders: s.folders.filter((f) => f.id !== id),
      items: s.items.filter((it) => it.folderId !== id),
    }));
    setSelectedFolderId((prev) => (prev === id ? null : prev));
  };

  // ===== ストレス項目追加 =====
  const addItem = () => {
    if (!selectedFolderId) {
      alert("まず左側でフォルダーを選択してください。");
      return;
    }
    const t = title.trim();
    const d = detail.trim();
    if (!t && !d) {
      alert("タイトルかメモのどちらかは入力してください。");
      return;
    }
    const now = Date.now();
    const item: VasItem = {
      id: uid(),
      folderId: selectedFolderId,
      title: t || "（タイトルなし）",
      detail: d,
      level: Math.max(0, Math.min(100, level | 0)),
      createdAt: now,
      updatedAt: now,
    };
    setStore((s) => ({
      ...s,
      items: [item, ...s.items],
    }));
    setTitle("");
    setDetail("");
    setLevel(50);
  };

  const updateItemLevel = (id: ID, newLevel: number) => {
    const lvl = Math.max(0, Math.min(100, newLevel | 0));
    const now = Date.now();
    setStore((s) => ({
      ...s,
      items: s.items.map((it) =>
        it.id === id ? { ...it, level: lvl, updatedAt: now } : it
      ),
    }));
  };

  const removeItem = (id: ID) => {
    if (!confirm("このストレス項目を削除します。よろしいですか？")) return;
    setStore((s) => ({
      ...s,
      items: s.items.filter((it) => it.id !== id),
    }));
  };

  // 選択フォルダー
  const selectedFolder = useMemo(
    () => store.folders.find((f) => f.id === selectedFolderId) ?? null,
    [store.folders, selectedFolderId]
  );

  // 選択フォルダーのストレス項目 + 並び替え
  const itemsOfFolder = useMemo(() => {
    if (!selectedFolderId) return [];
    const list = store.items.filter((it) => it.folderId === selectedFolderId);
    const sorted = [...list].sort((a, b) => {
      let d: number;
      if (sortKey === "createdAt") {
        d = a.createdAt - b.createdAt;
      } else {
        d = a.level - b.level;
      }
      return sortOrder === "asc" ? d : -d;
    });
    return sorted;
  }, [store.items, selectedFolderId, sortKey, sortOrder]);

  // 平均レベル（簡単な指標）
  const avgLevel = useMemo(() => {
    if (itemsOfFolder.length === 0) return null;
    const sum = itemsOfFolder.reduce((acc, it) => acc + it.level, 0);
    return Math.round((sum / itemsOfFolder.length) * 10) / 10;
  }, [itemsOfFolder]);

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      {/* 左：フォルダー一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm space-y-3">
        <h2 className="font-semibold mb-1">フォルダー</h2>
        <p className="text-xs text-gray-600 mb-2">
          大学・家・職場・その他…など、状況ごとにフォルダーを作って、その中でストレスを記録します。
        </p>

        {store.folders.length === 0 ? (
          <p className="text-xs text-gray-500 mb-2">
            まだフォルダーがありません。「大学」「家」など、まず1つ作ってみてください。
          </p>
        ) : (
          <ul className="space-y-1 text-sm mb-2">
            {store.folders.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-2"
              >
                <button
                  type="button"
                  onClick={() => setSelectedFolderId(f.id)}
                  className={
                    "flex-1 text-left rounded-xl px-3 py-1.5 border text-xs " +
                    (selectedFolderId === f.id
                      ? "bg-black text-white"
                      : "bg-white hover:bg-gray-50")
                  }
                >
                  {f.name}
                </button>
                <button
                  type="button"
                  onClick={() => removeFolder(f.id)}
                  className="text-[11px] rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t pt-3 mt-2">
          <h3 className="text-xs font-semibold mb-1">フォルダーを追加</h3>
          <div className="flex gap-2">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="flex-1 rounded-xl border px-3 py-2 text-xs"
              placeholder="例: 大学 / 家 / 職場 / その他"
            />
            <button
              type="button"
              onClick={addFolder}
              className="rounded-xl bg-black px-3 py-2 text-xs text-white font-semibold"
            >
              追加
            </button>
          </div>
        </div>
      </section>

      {/* 右：ストレス項目 + 並び替え */}
      <section className="rounded-2xl border p-4 shadow-sm space-y-4 min-h-[260px]">
        {!selectedFolder ? (
          <div className="text-sm text-gray-500">
            左側でフォルダーを選択するか、新しく作成してください。
          </div>
        ) : (
          <>
            {/* ヘッダー＋並び替え */}
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <h2 className="font-semibold text-base">
                  フォルダー: {selectedFolder.name}
                </h2>
                {avgLevel !== null && (
                  <p className="text-xs text-gray-600 mt-0.5">
                    このフォルダーの平均ストレスレベル:{" "}
                    <span className="font-semibold">{avgLevel}</span> / 100
                  </p>
                )}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-600">並び替え:</span>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="rounded-lg border px-2 py-1 text-xs"
                >
                  <option value="createdAt">作成日</option>
                  <option value="level">ストレスレベル</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setSortOrder((o) => (o === "asc" ? "desc" : "asc"))
                  }
                  className="rounded-lg border px-2 py-1 hover:bg-gray-50"
                >
                  {sortOrder === "asc" ? "昇順" : "降順"}
                </button>
              </div>
            </div>

            {/* 追加フォーム */}
            <div className="rounded-xl border bg-gray-50 px-3 py-3 space-y-2">
              <h3 className="text-xs font-semibold mb-1">
                ストレスを追加（VAS）
              </h3>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-xs"
                placeholder="一言タイトル（例：研究室の課題、親との会話、レジ対応 など）"
              />
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-xs leading-relaxed"
                rows={3}
                placeholder="具体的にどんな状況・どんなストレスか、メモしたいことがあれば自由に書いてください。（任意）"
              />
              <div className="flex flex-wrap items-center gap-3 mt-1">
                <div className="flex-1 min-w-[160px]">
                  <label className="text-[11px] text-gray-600">
                    ストレスレベル（0〜100）
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={level}
                    onChange={(e) => setLevel(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div className="text-sm font-semibold w-16 text-center">
                  {level}
                </div>
                <button
                  type="button"
                  onClick={addItem}
                  className="ml-auto rounded-xl bg-black px-4 py-2 text-xs text-white font-semibold"
                >
                  追加
                </button>
              </div>
            </div>

            {/* 一覧 */}
            <div className="rounded-xl border px-3 py-3">
              {itemsOfFolder.length === 0 ? (
                <p className="text-sm text-gray-500">
                  まだこのフォルダーにはストレス項目がありません。
                  <br />
                  上のフォームから、今気になっていることを1つだけでも記録してみましょう。
                </p>
              ) : (
                <ul className="space-y-2">
                  {itemsOfFolder.map((it) => (
                    <li
                      key={it.id}
                      className="rounded-xl border px-3 py-2 text-sm bg-white flex flex-col gap-2"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-semibold break-words">
                              {it.title}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeItem(it.id)}
                              className="text-[11px] rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                            >
                              削除
                            </button>
                          </div>
                          {it.detail && (
                            <p className="mt-1 text-xs text-gray-700 whitespace-pre-wrap break-words">
                              {it.detail}
                            </p>
                          )}
                          <div className="mt-1 text-[11px] text-gray-500 space-x-2">
                            <span>作成: {fmtDateTime(it.createdAt)}</span>
                            <span>／ 更新: {fmtDateTime(it.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="w-28 flex flex-col items-end gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-600">
                              レベル
                            </span>
                            <span className="text-sm font-semibold">
                              {it.level}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={it.level}
                            onChange={(e) =>
                              updateItemLevel(it.id, Number(e.target.value))
                            }
                            className="w-full"
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
