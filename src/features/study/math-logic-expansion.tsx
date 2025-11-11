// src/features/study/math-logic-expansion.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

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
  imageUrl: string;
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

// -------- MathMarkdown コンポーネント（KaTeX対応） --------
function MathMarkdown({ text }: { text: string }) {
  if (!text.trim()) {
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
        {text}
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

  const currentFolder = store.currentFolderId
    ? store.nodes[store.currentFolderId]
    : null;
  const currentFile = store.currentFileId
    ? store.files[store.currentFileId] ?? null
    : null;

  // Store変更 → localStorage + サーバ保存
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
    (async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, store);
      } catch (e) {
        console.warn("[math-logic-expansion] saveUserDoc failed:", e);
      }
    })();
  }, [store]);

  // 初回ロードでサーバの最新版を取り込み
  useEffect(() => {
    (async () => {
      try {
        const remote = await loadUserDoc<Store>(DOC_KEY);
        if (remote && remote.version === 1) {
          setStore(remote);
          saveLocal(remote);
        } else if (!remote) {
          // サーバが空ならローカル状態をアップロード
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        } else {
          // バージョン違いなどが来たときは、最低限フィールドを合わせる
          const def = createDefaultStore();
          const fallback: Store = {
            nodes: (remote as any).nodes ?? def.nodes,
            files: (remote as any).files ?? {},
            currentFolderId:
              (remote as any).currentFolderId ?? def.currentFolderId,
            currentFileId: (remote as any).currentFileId ?? null,
            version: 1,
          };
          setStore(fallback);
          saveLocal(fallback);
          await saveUserDoc<Store>(DOC_KEY, fallback);
        }
      } catch (e) {
        console.warn("[math-logic-expansion] loadUserDoc failed:", e);
      }
    })();
  }, []);

  // ツリー用ヘルパー
  const rootNodes = useMemo(
    () => Object.values(store.nodes).filter((n) => n.parentId === null),
    [store.nodes]
  );

  const childrenOf = (parentId: ID) =>
    Object.values(store.nodes).filter((n) => n.parentId === parentId);

  const selectFolder = (id: ID) => {
    setStore((s) => ({
      ...s,
      currentFolderId: id,
    }));
  };

  const selectFile = (id: ID) => {
    setStore((s) => ({
      ...s,
      currentFileId: id,
    }));
  };

  const addFolder = () => {
    if (!store.currentFolderId) return;
    const id = uid();
    const node: Node = {
      id,
      name: "新しいフォルダ",
      parentId: store.currentFolderId,
      kind: "folder",
    };
    setStore((s) => ({
      ...s,
      nodes: {
        ...s.nodes,
        [id]: node,
      },
    }));
  };

  const addFile = () => {
    if (!store.currentFolderId) return;
    const fileNodeId = uid();
    const fileNode: Node = {
      id: fileNodeId,
      name: "新しいファイル",
      parentId: store.currentFolderId,
      kind: "file",
    };
    const fileData: FileData = {
      id: fileNodeId,
      sets: [],
    };
    setStore((s) => ({
      ...s,
      nodes: {
        ...s.nodes,
        [fileNodeId]: fileNode,
      },
      files: {
        ...s.files,
        [fileNodeId]: fileData,
      },
      currentFileId: fileNodeId,
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

  const deleteNode = (id: ID) => {
    const node = store.nodes[id];
    if (!node) return;
    if (
      !confirm(
        `「${node.name}」を削除します。配下のファイル／フォルダも削除されます。よろしいですか？`
      )
    ) {
      return;
    }

    setStore((s) => {
      const nodes = { ...s.nodes };
      const files = { ...s.files };

      const removeRecursively = (targetId: ID) => {
        const n = nodes[targetId];
        if (!n) return;
        // 子を再帰的に削除
        for (const child of Object.values(nodes)) {
          if (child.parentId === targetId) {
            removeRecursively(child.id);
          }
        }
        // ファイルなら files も削除
        if (n.kind === "file") {
          delete files[targetId];
        }
        delete nodes[targetId];
      };

      removeRecursively(id);

      let currentFolderId = s.currentFolderId;
      let currentFileId = s.currentFileId;

      if (currentFolderId && !nodes[currentFolderId]) {
        currentFolderId =
          Object.values(nodes).find((n) => n.parentId === null)?.id ?? null;
      }
      if (currentFileId && !files[currentFileId]) {
        currentFileId = null;
      }

      return {
        ...s,
        nodes,
        files,
        currentFolderId,
        currentFileId,
      };
    });
  };

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

  // パンくずリスト
  const breadcrumb = useMemo(() => {
    if (!currentFolder) return [];
    const path: Node[] = [];
    let cur: Node | undefined | null = currentFolder;
    while (cur) {
      path.unshift(cur);
      cur = cur.parentId ? store.nodes[cur.parentId] : undefined;
    }
    return path;
  }, [currentFolder, store.nodes]);

  // ツリー描画
  const renderTree = (node: Node, depth: number) => {
    const indentClass = `pl-${Math.min(depth * 4, 12)}`;
    const children = childrenOf(node.id);
    return (
      <div key={node.id}>
        <div className={`flex items-center gap-1 py-0.5 ${indentClass}`}>
          {node.kind === "folder" ? (
            <>
              <button
                type="button"
                onClick={() => selectFolder(node.id)}
                className={
                  "rounded-lg px-2 py-1 text-sm flex-1 text-left " +
                  (store.currentFolderId === node.id
                    ? "bg-black text-white"
                    : "hover:bg-gray-100")
                }
              >
                📂 {node.name}
              </button>
              <button
                type="button"
                className="text-xs text-gray-500 hover:underline"
                onClick={() => renameNode(node.id)}
              >
                名称変更
              </button>
              {node.parentId !== null && (
                <button
                  type="button"
                  className="text-xs text-red-500 hover:underline"
                  onClick={() => deleteNode(node.id)}
                >
                  削除
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => selectFile(node.id)}
                className={
                  "rounded-lg px-2 py-1 text-sm flex-1 text-left " +
                  (store.currentFileId === node.id
                    ? "bg-blue-600 text-white"
                    : "hover:bg-gray-100")
                }
              >
                📄 {node.name}
              </button>
              <button
                type="button"
                className="text-xs text-gray-500 hover:underline"
                onClick={() => renameNode(node.id)}
              >
                名称変更
              </button>
              <button
                type="button"
                className="text-xs text-red-500 hover:underline"
                onClick={() => deleteNode(node.id)}
              >
                削除
              </button>
            </>
          )}
        </div>
        {children.map((child) => renderTree(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* 左：フォルダ／ファイルツリー */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">数学論理展開 フォルダー</h2>

        {/* パンくず */}
        <div className="mb-3 text-xs text-gray-500 flex flex-wrap gap-1">
          {breadcrumb.map((node, idx) => (
            <span key={node.id} className="flex items-center gap-1">
              {idx > 0 && <span>/</span>}
              <button
                type="button"
                className={
                  "hover:underline " +
                  (idx === breadcrumb.length - 1 ? "font-semibold" : "")
                }
                onClick={() =>
                  node.kind === "folder" ? selectFolder(node.id) : selectFile(node.id)
                }
              >
                {node.name}
              </button>
            </span>
          ))}
        </div>

        {/* ツリー */}
        <div className="mb-4 max-h-[360px] overflow-auto text-sm">
          {rootNodes.map((n) => renderTree(n, 0))}
        </div>

        {/* 操作ボタン */}
        <div className="space-y-2 border-t pt-3 mt-3">
          <button
            type="button"
            onClick={addFolder}
            className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            ＋ フォルダを追加
          </button>
          <button
            type="button"
            onClick={addFile}
            className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            ＋ ファイルを追加
          </button>
        </div>
      </section>

      {/* 右：ファイル内のセット一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[200px]">
        {!currentFile ? (
          <p className="text-sm text-gray-500">
            左のツリーからファイルを選択してください。
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">
                ファイル：「
                {store.nodes[currentFile.id]?.name ?? "（名称未設定）"}」
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

                      {/* 問題画像URL */}
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-700">
                          問題画像のURL
                        </label>
                        <input
                          value={set.imageUrl}
                          onChange={(e) =>
                            updateSet(set.id, (prev) => ({
                              ...prev,
                              imageUrl: e.target.value,
                            }))
                          }
                          placeholder="例：https://.../problem.png"
                          className="w-full rounded-lg border px-3 py-2 text-xs"
                        />
                        {set.imageUrl && (
                          <div className="mt-2 border rounded-lg overflow-hidden max-h-64 flex items-center justify-center bg-gray-50">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={set.imageUrl}
                              alt="問題画像プレビュー"
                              className="max-h-64 max-w-full object-contain"
                            />
                          </div>
                        )}
                      </div>

                      {/* 自分の解釈ノート */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-700">
                            自分の解釈ノート
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleReveal(set.id, "my")}
                            className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                          >
                            {rev.my ? "隠す" : "めくる"}
                          </button>
                        </div>
                        {/* 編集エリア */}
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
                        {/* 裏向き表示（復習用） */}
                        <div className="mt-2 rounded-xl border px-3 py-2 bg-gray-50">
                          {rev.my ? (
                            <MathMarkdown text={set.myNote} />
                          ) : (
                            <p className="text-xs text-gray-400">
                              （裏面）「めくる」を押すと、MathMarkdown + KaTeX で表示されます。
                            </p>
                          )}
                        </div>
                      </div>

                      {/* AIの添削ノート */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-700">
                            AIの添削ノート
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleReveal(set.id, "ai")}
                            className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                          >
                            {rev.ai ? "隠す" : "めくる"}
                          </button>
                        </div>
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
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-700">
                            過程式ノート
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleReveal(set.id, "steps")}
                            className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                          >
                            {rev.steps ? "隠す" : "めくる"}
                          </button>
                        </div>
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
  );
}
