// src/features/mental/defusion.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";

type ID = string;

export type DefusionFolder = {
  id: ID;
  name: string;
  createdAt: number;
};

export type DefusionSet = {
  id: ID;
  folderId: ID;
  thought: string; // 脱フュージョン対象の考え
  alternatives: string; // 代替説明リスト
  evidence: string; // 証拠集め
  createdAt: number;
  updatedAt: number;
};

type Store = {
  folders: DefusionFolder[];
  sets: DefusionSet[];
  currentFolderId: ID | null;
  version: 1;
};

const LOCAL_KEY = "mental_defusion_v1";
const DOC_KEY = "mental_defusion_v1";

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
      return { folders: [], sets: [], currentFolderId: null, version: 1 };
    }
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) {
      // 初期フォルダは空
      return { folders: [], sets: [], currentFolderId: null, version: 1 };
    }
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || typeof parsed !== "object") {
      return { folders: [], sets: [], currentFolderId: null, version: 1 };
    }
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      sets: Array.isArray(parsed.sets) ? parsed.sets : [],
      currentFolderId: parsed.currentFolderId ?? null,
      version: 1,
    };
  } catch {
    return { folders: [], sets: [], currentFolderId: null, version: 1 };
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

const fmtDateTime = (t: number) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(t));

// ===== 本体コンポーネント =====
export default function Defusion() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // フォルダ追加フォーム
  const [folderName, setFolderName] = useState("");
  const [newThought, setNewThought] = useState("");
  const [newAlternatives, setNewAlternatives] = useState("");
  const [newEvidence, setNewEvidence] = useState("");

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
          console.warn("[defusion] manual PULL failed:", e);
        }
      },
      // ☁ アップロード（ローカル→クラウド）
      push: async () => {
        try {
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        } catch (e) {
          console.warn("[defusion] manual PUSH failed:", e);
        }
      },
      // ⚠ RESET: since 未使用なので特別な処理は不要
      reset: async () => {
        /* no-op */
      },
    });
    return unsubscribe;
  }, []);

  const { folders, sets, currentFolderId } = store;

  const currentFolder = useMemo(
    () => folders.find((f) => f.id === currentFolderId) ?? null,
    [folders, currentFolderId]
  );

  const setsInCurrentFolder = useMemo(
    () =>
      currentFolderId
        ? sets
            .filter((s) => s.folderId === currentFolderId)
            .sort((a, b) => b.createdAt - a.createdAt)
        : [],
    [sets, currentFolderId]
  );

  // ===== フォルダ操作 =====
  const addFolder = () => {
    const name = folderName.trim();
    if (!name) {
      alert("フォルダー名を入力してください。（例：大学／家／職場 など）");
      return;
    }
    const now = Date.now();
    const folder: DefusionFolder = { id: uid(), name, createdAt: now };
    setStore((s) => ({
      ...s,
      folders: [...s.folders, folder],
      currentFolderId: s.currentFolderId ?? folder.id,
    }));
    setFolderName("");
  };

  const selectFolder = (id: ID) => {
    setStore((s) => ({ ...s, currentFolderId: id }));
  };

  const removeFolder = (id: ID) => {
    const folder = folders.find((f) => f.id === id);
    const count = sets.filter((s) => s.folderId === id).length;
    if (
      !confirm(
        `フォルダー「${folder?.name ?? ""}」を削除します。\n` +
          `このフォルダーに属するセット ${count} 件も削除されます。よろしいですか？`
      )
    ) {
      return;
    }
    setStore((s) => {
      const newFolders = s.folders.filter((f) => f.id !== id);
      const newSets = s.sets.filter((st) => st.folderId !== id);
      const nextCurrent =
        s.currentFolderId === id
          ? newFolders.length > 0
            ? newFolders[newFolders.length - 1].id
            : null
          : s.currentFolderId;
      return {
        ...s,
        folders: newFolders,
        sets: newSets,
        currentFolderId: nextCurrent,
      };
    });
  };

  // ===== セット追加 =====
  const addSet = () => {
    if (!currentFolderId) {
      alert("先に左側でフォルダーを作成・選択してください。");
      return;
    }
    const t = newThought.trim();
    const a = newAlternatives.trim();
    const e = newEvidence.trim();
    if (!t && !a && !e) {
      alert("どれか1つ以上の欄に入力してください。");
      return;
    }
    const now = Date.now();
    const set: DefusionSet = {
      id: uid(),
      folderId: currentFolderId,
      thought: t,
      alternatives: a,
      evidence: e,
      createdAt: now,
      updatedAt: now,
    };
    setStore((s) => ({
      ...s,
      sets: [set, ...s.sets],
    }));
    setNewThought("");
    setNewAlternatives("");
    setNewEvidence("");
  };

  // ===== セット更新 / 削除 =====
  const updateSetField = (
    id: ID,
    field: "thought" | "alternatives" | "evidence",
    value: string
  ) => {
    const v = value;
    const now = Date.now();
    setStore((s) => ({
      ...s,
      sets: s.sets.map((st) =>
        st.id === id ? { ...st, [field]: v, updatedAt: now } : st
      ),
    }));
  };

  const removeSet = (id: ID) => {
    if (!confirm("このセットを削除します。よろしいですか？")) return;
    setStore((s) => ({
      ...s,
      sets: s.sets.filter((st) => st.id !== id),
    }));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* 左：フォルダー一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm space-y-3">
        <h2 className="font-semibold mb-1">フォルダー</h2>
        <p className="text-xs text-gray-600 mb-2">
          状況ごとにフォルダーを作って整理します。
          <br />
          例: 「大学」「家」「バイト先」「その他」など
        </p>

        {folders.length === 0 ? (
          <p className="text-xs text-gray-500">
            まだフォルダーがありません。下のフォームから作成してください。
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {folders.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-2"
              >
                <button
                  type="button"
                  onClick={() => selectFolder(f.id)}
                  className={
                    "flex-1 text-left rounded-xl px-3 py-1.5 border " +
                    (currentFolderId === f.id
                      ? "bg-black text-white"
                      : "bg-white hover:bg-gray-50")
                  }
                >
                  <div className="font-medium break-words">{f.name}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    作成: {fmtDateTime(f.createdAt)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => removeFolder(f.id)}
                  className="text-xs rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t pt-3 mt-3">
          <h3 className="text-xs font-semibold mb-1">フォルダーを追加</h3>
          <div className="flex gap-2">
            <input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
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

      {/* 右：選択フォルダー内のセット */}
      <section className="rounded-2xl border p-4 shadow-sm space-y-4 min-h-[260px]">
        {!currentFolder ? (
          <div className="text-sm text-gray-500">
            左側でフォルダーを作成し、選択してください。
            <br />
            そのフォルダーの中に「脱フュージョン」用のノートセットを追加できます。
          </div>
        ) : (
          <>
            <div>
              <h2 className="font-semibold text-base">
                フォルダー: {currentFolder.name}
              </h2>
              <p className="mt-1 text-xs text-gray-600">
                1セット = 「脱フュージョン / 代替説明リスト / 証拠集め」の3つのノートです。
                <br />
                浮かんだ考えをそのまま書き出し、別の説明や証拠を探していきます。
              </p>
            </div>

            {/* 追加フォーム */}
            <section className="rounded-xl border bg-gray-50 px-3 py-3 space-y-2">
              <h3 className="text-sm font-semibold">新しいセットを追加</h3>
              <div className="space-y-2">
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-1">
                    ① 脱フュージョンしたい考え
                  </div>
                  <textarea
                    value={newThought}
                    onChange={(e) => setNewThought(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-xs leading-relaxed"
                    rows={3}
                    placeholder="例: 「自分は必ず失敗する」「みんなに嫌われている」など、頭に浮かんでくる考えをそのまま書きます。"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-1">
                    ② 代替説明リスト
                  </div>
                  <textarea
                    value={newAlternatives}
                    onChange={(e) => setNewAlternatives(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-xs leading-relaxed"
                    rows={3}
                    placeholder="その出来事には、他にどんな説明がありえますか？ 箇条書きでもOKです。"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-1">
                    ③ 証拠集め
                  </div>
                  <textarea
                    value={newEvidence}
                    onChange={(e) => setNewEvidence(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-xs leading-relaxed"
                    rows={3}
                    placeholder="その考えを裏付ける証拠／反対の証拠は何がありますか？ 過去の経験や周りの反応などを書き出してみてください。"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 mt-2">
                <button
                  type="button"
                  onClick={addSet}
                  className="rounded-xl bg-black px-4 py-2 text-xs text-white font-semibold"
                >
                  セットを追加
                </button>
                <p className="text-[11px] text-gray-500">
                  ※ 追加後は下の一覧からいつでも編集できます。
                </p>
              </div>
            </section>

            {/* セット一覧 */}
            <section className="space-y-2">
              {setsInCurrentFolder.length === 0 ? (
                <p className="text-sm text-gray-500">
                  このフォルダーには、まだセットがありません。
                  <br />
                  上のフォームから、最初の1件を追加してみてください。
                </p>
              ) : (
                <ul className="space-y-3">
                  {setsInCurrentFolder.map((st, idx) => (
                    <li
                      key={st.id}
                      className="rounded-xl border px-3 py-3 bg-white space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs text-gray-500">
                          セット {idx + 1} ／ 作成: {fmtDateTime(st.createdAt)}
                          <br />
                          <span>
                            最終更新: {fmtDateTime(st.updatedAt)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSet(st.id)}
                          className="text-xs rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                        >
                          削除
                        </button>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <div className="text-xs font-semibold text-gray-700 mb-1">
                            ① 脱フュージョンしたい考え
                          </div>
                          <textarea
                            value={st.thought}
                            onChange={(e) =>
                              updateSetField(st.id, "thought", e.target.value)
                            }
                            className="w-full rounded-lg border px-3 py-2 text-xs leading-relaxed"
                            rows={3}
                          />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-700 mb-1">
                            ② 代替説明リスト
                          </div>
                          <textarea
                            value={st.alternatives}
                            onChange={(e) =>
                              updateSetField(
                                st.id,
                                "alternatives",
                                e.target.value
                              )
                            }
                            className="w-full rounded-lg border px-3 py-2 text-xs leading-relaxed"
                            rows={3}
                          />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-700 mb-1">
                            ③ 証拠集め
                          </div>
                          <textarea
                            value={st.evidence}
                            onChange={(e) =>
                              updateSetField(st.id, "evidence", e.target.value)
                            }
                            className="w-full rounded-lg border px-3 py-2 text-xs leading-relaxed"
                            rows={3}
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}
