// src/features/study/math-logic-expansion.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
// ※ KaTeX の CSS は app/layout.tsx かグローバルCSSで読み込んでください。
// 例: import "katex/dist/katex.min.css";

type ID = string;

type NodeKind = "folder" | "file";

type Node = {
  id: ID;
  name: string;
  parentId: ID | null;
  kind: NodeKind;
};

type MathSet = {
  id: ID;
  imageUrl: string; // data URL or http(s) URL
  myNote: string;
  aiNote: string;
  stepsNote: string;
};

type FileData = {
  id: ID;
  sets: MathSet[];
};

type Store = {
  nodes: Record<ID, Node>;
  files: Record<ID, FileData>;
  currentFolderId: ID | null;
  currentFileId: ID | null;
  version: 1;
};

const LOCAL_KEY = "math_logic_expansion_v1";
const DOC_KEY = "math_logic_expansion_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

// ------ LaTeX テキスト自動補正 ------
// 1) ¥ (U+00A5) を \ に変換
// 2) $$ ... $$ を前後改行付きのブロック形式に整える
function normalizeMathText(raw: string): string {
  if (!raw) return "";

  let text = raw;

  // 1) 日本語環境で紛れ込みがちな「¥」をバックスラッシュに変換
  text = text.replace(/¥/g, "\\");

  // 2) $$ ... $$ ブロックを前後改行付きの独立ブロックに整形
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_match, inner) => {
    const trimmed = String(inner).trim();
    return `\n$$\n${trimmed}\n$$\n`;
  });

  return text;
}

// -------- MathMarkdown コンポーネント（KaTeX対応） --------
function MathMarkdown({ text }: { text: string }) {
  const normalized = normalizeMathText(text);

  if (!normalized.trim()) {
    return (
      <p className="text-xs text-gray-400 italic">
        まだ内容がありません。上のテキストを編集して保存してください。
      </p>
    );
  }

  return (
    <div className="prose max-w-none prose-sm">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

// -------- Store ロード／保存 --------
function createDefaultStore(): Store {
  const rootId = uid();
  const rootNode: Node = {
    id: rootId,
    name: "数学論理展開",
    parentId: null,
    kind: "folder",
  };

  return {
    nodes: {
      [rootId]: rootNode,
    },
    files: {},
    currentFolderId: rootId,
    currentFileId: null,
    version: 1,
  };
}

function loadLocal(): Store {
  try {
    if (typeof window === "undefined") return createDefaultStore();
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createDefaultStore();
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (!parsed || typeof parsed !== "object") return createDefaultStore();

    const def = createDefaultStore();
    return {
      nodes: parsed.nodes ?? def.nodes,
      files: parsed.files ?? {},
      currentFolderId: parsed.currentFolderId ?? def.currentFolderId,
      currentFileId: parsed.currentFileId ?? null,
      version: 1,
    };
  } catch {
    return createDefaultStore();
  }
}

function saveLocal(store: Store) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
    }
  } catch {
    // 無視
  }
}

// -------- メインコンポーネント --------
export default function MathLogicExpansion() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // セットごとの「めくる」状態
  type RevealState = {
    my: boolean;
    ai: boolean;
    steps: boolean;
  };
  const [revealMap, setRevealMap] = useState<Record<ID, RevealState>>({});

  // セットごとの「入力エリアを開く/隠す」状態
  type EditState = {
    my: boolean;
    ai: boolean;
    steps: boolean;
  };
  const [editMap, setEditMap] = useState<Record<ID, EditState>>({});

  // 左側：フォルダ／ファイル作成用
  const [newFolderName, setNewFolderName] = useState("");
  const [newFileName, setNewFileName] = useState("");

  // 画像拡大用
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const currentFile = store.currentFileId
    ? store.files[store.currentFileId] ?? null
    : null;

  // Store変更 → localStorage 即時保存（サーバーはホームの手動同期ボタン経由）
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
          console.warn("[math-logic-expansion] manual PULL failed:", e);
        }
      },
      // ☁ アップロード（ローカル→クラウド）
      push: async () => {
        try {
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        } catch (e) {
          console.warn("[math-logic-expansion] manual PUSH failed:", e);
        }
      },
      // ⚠ RESET: since 未使用なので特別な処理は不要
      reset: async () => {
        /* no-op */
      },
    });
    return unsubscribe;
  }, []);

  // ========= フォルダ／ファイル（code-reading と同じ構造） =========
  const nodes = store.nodes;
  const currentFolderId = store.currentFolderId;
  const currentFileId = store.currentFileId;

  const currentFolder = currentFolderId ? nodes[currentFolderId] ?? null : null;

  // カレントフォルダ直下の children（フォルダ→ファイルの順）
  const children = useMemo(() => {
    const list = Object.values(nodes).filter(
      (n) => n.parentId === currentFolderId
    );
    return list.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name, "ja");
    });
  }, [nodes, currentFolderId]);

  // パンくず
  const breadcrumb = useMemo(() => {
    const items: Node[] = [];
    let curId = currentFolderId;
    while (curId) {
      const n = nodes[curId];
      if (!n) break;
      items.push(n);
      curId = n.parentId;
    }
    return items.reverse();
  }, [nodes, currentFolderId]);

  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    setStore((s) => {
      const id = uid();
      const node: Node = {
        id,
        name,
        parentId: s.currentFolderId,
        kind: "folder",
      };
      return {
        ...s,
        nodes: { ...s.nodes, [id]: node },
      };
    });
    setNewFolderName("");
  };

  const addFile = () => {
    const name = newFileName.trim();
    if (!name) return;
    setStore((s) => {
      const id = uid();
      const node: Node = {
        id,
        name,
        parentId: s.currentFolderId,
        kind: "file",
      };
      const fileData: FileData = {
        id,
        sets: [],
      };
      return {
        ...s,
        nodes: { ...s.nodes, [id]: node },
        files: { ...s.files, [id]: fileData },
        currentFileId: id,
      };
    });
    setNewFileName("");
  };

  const openFolder = (id: ID) => {
    setStore((s) => ({
      ...s,
      currentFolderId: id,
      currentFileId:
        s.currentFileId && s.nodes[s.currentFileId]?.parentId === id
          ? s.currentFileId
          : null,
    }));
  };

  const openFile = (id: ID) => {
    setStore((s) => ({
      ...s,
      currentFileId: id,
    }));
  };

  const goUpFolder = () => {
    if (!currentFolderId) return;
    const cur = nodes[currentFolderId];
    if (!cur) return;
    setStore((s) => ({
      ...s,
      currentFolderId: cur.parentId,
      currentFileId: null,
    }));
  };

  const renameNode = (id: ID) => {
    const node = store.nodes[id];
    if (!node) return;
    const name = window.prompt("新しい名前を入力してください", node.name);
    if (!name) return;
    setStore((s) => ({
      ...s,
      nodes: {
        ...s.nodes,
        [id]: { ...s.nodes[id], name },
      },
    }));
  };

  // フォルダ削除（中身も再帰的に削除）
  const deleteFolder = (id: ID) => {
    if (!confirm("このフォルダと中身をすべて削除します。よろしいですか？")) return;

    setStore((s) => {
      const toDelete = new Set<ID>();
      const queue: ID[] = [id];

      while (queue.length > 0) {
        const cur = queue.shift()!;
        toDelete.add(cur);
        for (const n of Object.values(s.nodes)) {
          if (n.parentId === cur) queue.push(n.id);
        }
      }

      const nextNodes: Record<ID, Node> = {};
      const nextFiles: Record<ID, FileData> = {};

      for (const [nid, node] of Object.entries(s.nodes)) {
        if (!toDelete.has(nid)) nextNodes[nid] = node;
      }
      for (const [fid, file] of Object.entries(s.files)) {
        if (!toDelete.has(fid)) nextFiles[fid] = file;
      }

      const currentFolderIdNew = toDelete.has(s.currentFolderId ?? "")
        ? null
        : s.currentFolderId;
      const currentFileIdNew = toDelete.has(s.currentFileId ?? "")
        ? null
        : s.currentFileId;

      return {
        ...s,
        nodes: nextNodes,
        files: nextFiles,
        currentFolderId: currentFolderIdNew,
        currentFileId: currentFileIdNew,
      };
    });
  };

  const deleteFile = (id: ID) => {
    if (!confirm("このファイルを削除します。よろしいですか？")) return;
    setStore((s) => {
      const nextNodes = { ...s.nodes };
      const nextFiles = { ...s.files };
      delete nextNodes[id];
      delete nextFiles[id];
      const currentFileIdNew = s.currentFileId === id ? null : s.currentFileId;
      return {
        ...s,
        nodes: nextNodes,
        files: nextFiles,
        currentFileId: currentFileIdNew,
      };
    });
  };

  // ========= セット操作 =========
  const addSet = () => {
    if (!currentFile) return;
    const newSet: MathSet = {
      id: uid(),
      imageUrl: "",
      myNote: "",
      aiNote: "",
      stepsNote: "",
    };
    setStore((s) => ({
      ...s,
      files: {
        ...s.files,
        [currentFile.id]: {
          ...s.files[currentFile.id],
          sets: [...(s.files[currentFile.id]?.sets ?? []), newSet],
        },
      },
    }));
  };

  const updateSet = (setId: ID, updater: (prev: MathSet) => MathSet) => {
    if (!currentFile) return;
    setStore((s) => {
      const file = s.files[currentFile.id];
      if (!file) return s;
      const sets = file.sets.map((st) =>
        st.id === setId ? updater(st) : st
      );
      return {
        ...s,
        files: {
          ...s.files,
          [currentFile.id]: { ...file, sets },
        },
      };
    });
  };

  const deleteSet = (setId: ID) => {
    if (!currentFile) return;
    if (!confirm("このセットを削除しますか？")) return;
    setStore((s) => {
      const file = s.files[currentFile.id];
      if (!file) return s;
      const sets = file.sets.filter((st) => st.id !== setId);
      return {
        ...s,
        files: {
          ...s.files,
          [currentFile.id]: { ...file, sets },
        },
      };
    });
    setRevealMap((prev) => {
      const copy = { ...prev };
      delete copy[setId];
      return copy;
    });
    setEditMap((prev) => {
      const copy = { ...prev };
      delete copy[setId];
      return copy;
    });
  };

  const toggleReveal = (setId: ID, key: keyof RevealState) => {
    setRevealMap((prev) => {
      const st = prev[setId] ?? { my: false, ai: false, steps: false };
      return {
        ...prev,
        [setId]: {
          ...st,
          [key]: !st[key],
        },
      };
    });
  };

  const toggleEdit = (setId: ID, key: keyof EditState) => {
    setEditMap((prev) => {
      const st = prev[setId] ?? { my: false, ai: false, steps: false };
      return {
        ...prev,
        [setId]: {
          ...st,
          [key]: !st[key],
        },
      };
    });
  };

  // 画像ペーストハンドラ（画像 or URL）
  const handleImagePaste = (setId: ID, e: ClipboardEvent<HTMLDivElement>) => {
    const clipboard = e.clipboardData;
    if (!clipboard) return;

    let handled = false;

    // 1) 画像データがあれば data URL として保存
    const items = clipboard.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            if (typeof result === "string") {
              updateSet(setId, (prev) => ({
                ...prev,
                imageUrl: result, // data URL
              }));
            }
          };
          reader.readAsDataURL(file);
          handled = true;
        }
      }
    }

    // 2) 画像が無ければ、テキストを URL として扱う
    if (!handled) {
      const text = clipboard.getData("text");
      if (text && text.trim()) {
        updateSet(setId, (prev) => ({
          ...prev,
          imageUrl: text.trim(),
        }));
        handled = true;
      }
    }

    if (handled) {
      e.preventDefault();
    }
  };

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* 左：フォルダ＆ファイルツリー（code-reading と同じUIベース） */}
        <section className="rounded-2xl border p-4 shadow-sm">
          <h2 className="font-semibold mb-3">数学論理展開</h2>

          <div className="mb-3 text-xs text-gray-600">
            <div className="mb-1 font-medium">現在のフォルダ</div>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setStore((s) => ({
                    ...s,
                    currentFolderId: null,
                    currentFileId: null,
                  }))
                }
                className={
                  "text-xs rounded-lg px-2 py-1 " +
                  (currentFolderId === null
                    ? "bg-black text-white"
                    : "bg-gray-100 hover:bg-gray-200")
                }
              >
                ルート
              </button>
              {breadcrumb.map((b) => (
                <span key={b.id} className="flex items-center gap-1">
                  <span className="text-gray-400">/</span>
                  <button
                    type="button"
                    onClick={() => openFolder(b.id)}
                    className={
                      "text-xs rounded-lg px-2 py-1 " +
                      (currentFolderId === b.id
                        ? "bg-black text-white"
                        : "bg-gray-100 hover:bg-gray-200")
                    }
                  >
                    {b.name}
                  </button>
                </span>
              ))}
            </div>
          </div>

          {currentFolderId !== null && (
            <button
              type="button"
              onClick={goUpFolder}
              className="mb-3 text-xs text-gray-600 underline"
            >
              上のフォルダに戻る
            </button>
          )}

          <div className="mb-3">
            {children.length === 0 ? (
              <p className="text-xs text-gray-500">
                このフォルダには、まだ何もありません。
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {children.map((n) => (
                  <li
                    key={n.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        n.kind === "folder" ? openFolder(n.id) : openFile(n.id)
                      }
                      className={
                        "flex-1 text-left rounded-xl px-3 py-1.5 border " +
                        (currentFileId === n.id
                          ? "bg-blue-600 text-white"
                          : "bg-white hover:bg-gray-50")
                      }
                    >
                      <span className="mr-2 text-xs text-gray-400">
                        {n.kind === "folder" ? "📁" : "📄"}
                      </span>
                      {n.name}
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => renameNode(n.id)}
                        className="text-xs rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                      >
                        名称変更
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          n.kind === "folder"
                            ? deleteFolder(n.id)
                            : deleteFile(n.id)
                        }
                        className="text-xs rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                      >
                        削除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t pt-3 mt-3 space-y-3">
            <div>
              <h3 className="text-xs font-semibold mb-1">フォルダを追加</h3>
              <div className="flex gap-2">
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="flex-1 rounded-xl border px-3 py-2 text-xs"
                  placeholder="例: 章1 / 数II / 過去問 など"
                />
                <button
                  type="button"
                  onClick={addFolder}
                  className="rounded-xl bg-black px-3 py-2 text-xs text-white"
                >
                  追加
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold mb-1">ファイルを追加</h3>
              <div className="flex gap-2">
                <input
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  className="flex-1 rounded-xl border px-3 py-2 text-xs"
                  placeholder="例: 2023年第3問 / 練習問題1 など"
                />
                <button
                  type="button"
                  onClick={addFile}
                  className="rounded-xl bg-black px-3 py-2 text-xs text-white"
                >
                  追加
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 右：ファイル内のセット一覧 */}
        <section className="rounded-2xl border p-4 shadow-sm min-h-[200px]">
          {!currentFile ? (
            <p className="text-sm text-gray-500">
              左のフォルダからファイルを選択するか、新しいファイルを作成してください。
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">
                  ファイル：「
                  {nodes[currentFile.id]?.name ?? "（名称未設定）"}」
                </h2>
                <button
                  type="button"
                  onClick={addSet}
                  className="rounded-xl bg-black px-3 py-2 text-sm text-white"
                >
                  ＋ セットを追加
                </button>
              </div>

              {currentFile.sets.length === 0 ? (
                <p className="text-sm text-gray-500">
                  まだセットがありません。「＋ セットを追加」から、問題画像＋解釈ノートを追加してください。
                </p>
              ) : (
                <div className="space-y-4">
                  {currentFile.sets.map((set, idx) => {
                    const rev = revealMap[set.id] ?? {
                      my: false,
                      ai: false,
                      steps: false,
                    };
                    const edit = editMap[set.id] ?? {
                      my: false,
                      ai: false,
                      steps: false,
                    };

                    return (
                      <div
                        key={set.id}
                        className="rounded-2xl border px-4 py-3 bg-white space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">
                            セット {idx + 1}
                          </h3>
                          <button
                            type="button"
                            onClick={() => deleteSet(set.id)}
                            className="text-xs text-red-500 hover:underline"
                          >
                            セット削除
                          </button>
                        </div>

                        {/* 問題画像：ペースト対応 + クリック拡大 */}
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-gray-700">
                            問題画像
                          </label>
                          <div
                            className="w-full rounded-lg border px-3 py-2 text-xs bg-white cursor-text"
                            tabIndex={0}
                            onPaste={(e) => handleImagePaste(set.id, e)}
                          >
                            <p className="text-[11px] text-gray-500">
                              ここをクリックしてから Ctrl+V で問題画像を貼り付け
                              （画像そのもの or 画像URL）
                            </p>
                          </div>
                          {set.imageUrl && (
                            <div className="mt-2 border rounded-lg overflow-hidden max-h-64 flex flex-col items-center justify-center bg-gray-50 gap-1">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={set.imageUrl}
                                alt="問題画像プレビュー"
                                className="max-h-64 max-w-full object-contain cursor-zoom-in"
                                onClick={() =>
                                  setPreviewImageUrl(set.imageUrl || null)
                                }
                              />
                              <div className="mb-2 flex gap-2 text-[11px]">
                                <span className="text-gray-500">
                                  画像をクリックすると拡大表示できます。
                                </span>
                                <button
                                  type="button"
                                  className="text-gray-500 hover:underline"
                                  onClick={() =>
                                    updateSet(set.id, (prev) => ({
                                      ...prev,
                                      imageUrl: "",
                                    }))
                                  }
                                >
                                  画像を削除する
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 自分の解釈ノート */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-gray-700">
                              自分の解釈ノート
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => toggleEdit(set.id, "my")}
                                className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                              >
                                {edit.my ? "入力を隠す" : "入力を開く"}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleReveal(set.id, "my")}
                                className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                              >
                                {rev.my ? "隠す" : "めくる"}
                              </button>
                            </div>
                          </div>
                          {edit.my && (
                            <textarea
                              value={set.myNote}
                              onChange={(e) =>
                                updateSet(set.id, (prev) => ({
                                  ...prev,
                                  myNote: e.target.value,
                                }))
                              }
                              rows={3}
                              className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
                              placeholder="ここに自分の解釈を書きます。LaTeXもOK：例）$y'' + \frac{9}{4}y = 0$ や $$\lambda^2 + \frac{9}{4} = 0$$"
                            />
                          )}
                          <div className="mt-2 rounded-xl border px-3 py-2 bg-gray-50">
                            {rev.my ? (
                              <MathMarkdown text={set.myNote} />
                            ) : (
                              <p className="text-xs text-gray-400">
                                （裏面）「めくる」を押すと、MathMarkdown + KaTeX
                                で表示されます。
                              </p>
                            )}
                          </div>
                        </div>

                        {/* AIの添削ノート */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-gray-700">
                              AIの添削ノート
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => toggleEdit(set.id, "ai")}
                                className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                              >
                                {edit.ai ? "入力を隠す" : "入力を開く"}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleReveal(set.id, "ai")}
                                className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                              >
                                {rev.ai ? "隠す" : "めくる"}
                              </button>
                            </div>
                          </div>
                          {edit.ai && (
                            <textarea
                              value={set.aiNote}
                              onChange={(e) =>
                                updateSet(set.id, (prev) => ({
                                  ...prev,
                                  aiNote: e.target.value,
                                }))
                              }
                              rows={3}
                              className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
                              placeholder="GeminiやChatGPTの添削を貼り付けてください。LaTeX もそのままOK。"
                            />
                          )}
                          <div className="mt-2 rounded-xl border px-3 py-2 bg-gray-50">
                            {rev.ai ? (
                              <MathMarkdown text={set.aiNote} />
                            ) : (
                              <p className="text-xs text-gray-400">
                                （裏面）「めくる」でAIの添削を表示します。
                              </p>
                            )}
                          </div>
                        </div>

                        {/* 過程式ノート */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-gray-700">
                              過程式ノート
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => toggleEdit(set.id, "steps")}
                                className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                              >
                                {edit.steps ? "入力を隠す" : "入力を開く"}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleReveal(set.id, "steps")}
                                className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                              >
                                {rev.steps ? "隠す" : "めくる"}
                              </button>
                            </div>
                          </div>
                          {edit.steps && (
                            <textarea
                              value={set.stepsNote}
                              onChange={(e) =>
                                updateSet(set.id, (prev) => ({
                                  ...prev,
                                  stepsNote: e.target.value,
                                }))
                              }
                              rows={4}
                              className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
                              placeholder="解答の途中式を詳細に書いてください。LaTeX もそのまま貼れます。"
                            />
                          )}
                          <div className="mt-2 rounded-xl border px-3 py-2 bg-gray-50">
                            {rev.steps ? (
                              <MathMarkdown text={set.stepsNote} />
                            ) : (
                              <p className="text-xs text-gray-400">
                                （裏面）「めくる」で途中式を表示します。
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* 画像拡大オーバーレイ */}
      {previewImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPreviewImageUrl(null)}
        >
          <div
            className="max-w-[min(100vw-2rem,920px)] max-h-[min(100vh-4rem,720px)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImageUrl}
              alt="拡大画像"
              className="max-w-full max-h-[calc(100vh-6rem)] object-contain rounded-xl bg-black"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewImageUrl(null)}
                className="rounded-lg bg-white/90 px-3 py-1 text-xs shadow"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
