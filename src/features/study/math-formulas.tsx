// src/features/study/math-formulas.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

type ID = string;
type NodeKind = "folder" | "file";

type Node = {
  id: ID;
  name: string;
  parentId: ID | null;
  kind: NodeKind;
};

type FormulaSet = {
  id: ID;
  title: string;
  formula: string;
};

type FileData = {
  id: ID;
  sets: FormulaSet[];
};

type Store = {
  nodes: Record<ID, Node>;
  files: Record<ID, FileData>;
  currentFolderId: ID | null;
  currentFileId: ID | null;
  version: 1;
};

const LOCAL_KEY = "math_formulas_v1";
const DOC_KEY = "math_formulas_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

// ---------- KaTeX対応 ----------
function normalizeMathText(raw: string): string {
  if (!raw) return "";
  let text = raw.replace(/¥/g, "\\");
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => {
    const trimmed = String(inner).trim();
    return `\n$$\n${trimmed}\n$$\n`;
  });
  return text;
}

function MathMarkdown({ text }: { text: string }) {
  const normalized = normalizeMathText(text);
  if (!normalized.trim()) {
    return <p className="text-xs text-gray-400 italic">（内容なし）</p>;
  }
  return (
    <div className="prose max-w-none prose-sm">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

// ---------- 初期構成 ----------
function createDefaultStore(): Store {
  const rootId = uid();
  const node: Node = {
    id: rootId,
    name: "数学公式",
    parentId: null,
    kind: "folder",
  };
  return {
    nodes: { [rootId]: node },
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
    const parsed = JSON.parse(raw) as Store;
    return { ...parsed, version: 1 };
  } catch {
    return createDefaultStore();
  }
}

function saveLocal(store: Store) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
    }
  } catch {}
}

// ---------- メイン ----------
export default function MathFormulas() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  const [newFolderName, setNewFolderName] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [revealMap, setRevealMap] = useState<Record<ID, boolean>>({});

  const currentFolderId = store.currentFolderId;
  const currentFileId = store.currentFileId;

  // 同期保存
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
    (async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, store);
      } catch {}
    })();
  }, [store]);

  // 初回ロード
  useEffect(() => {
    (async () => {
      try {
        const remote = await loadUserDoc<Store>(DOC_KEY);
        if (remote && remote.version === 1) {
          setStore(remote);
          saveLocal(remote);
        } else if (!remote) {
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        } else {
          const migrated: Store = { ...(remote as Store), version: 1 };
          setStore(migrated);
          saveLocal(migrated);
          await saveUserDoc<Store>(DOC_KEY, migrated);
        }
      } catch {}
    })();
  }, []);

  const nodes = store.nodes;
  const currentFolder = currentFolderId ? nodes[currentFolderId] ?? null : null;

  // 子一覧
  const children = useMemo(() => {
    const list = Object.values(nodes).filter(
      (n) => n.parentId === currentFolderId
    );
    return list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
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

  const currentFile = currentFileId ? store.files[currentFileId] ?? null : null;

  // ---------- フォルダ／ファイル操作 ----------
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
      return { ...s, nodes: { ...s.nodes, [id]: node } };
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
      const fileData: FileData = { id, sets: [] };
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

  const openFile = (id: ID) => setStore((s) => ({ ...s, currentFileId: id }));

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
      return { ...s, nodes: nextNodes, files: nextFiles };
    });
  };

  const deleteFile = (id: ID) => {
    if (!confirm("このファイルを削除しますか？")) return;
    setStore((s) => {
      const nextNodes = { ...s.nodes };
      const nextFiles = { ...s.files };
      delete nextNodes[id];
      delete nextFiles[id];
      return { ...s, nodes: nextNodes, files: nextFiles, currentFileId: null };
    });
  };

  // ---------- 数学公式操作 ----------
  const addSet = () => {
    if (!currentFileId) return;
    setStore((s) => {
      const f = s.files[currentFileId];
      if (!f) return s;
      const newSet: FormulaSet = { id: uid(), title: "", formula: "" };
      return {
        ...s,
        files: {
          ...s.files,
          [currentFileId]: { ...f, sets: [...f.sets, newSet] },
        },
      };
    });
  };

  const updateSet = (
    fileId: ID,
    setId: ID,
    field: keyof FormulaSet,
    value: string
  ) => {
    setStore((s) => {
      const f = s.files[fileId];
      if (!f) return s;
      const sets = f.sets.map((st) =>
        st.id === setId ? { ...st, [field]: value } : st
      );
      return { ...s, files: { ...s.files, [fileId]: { ...f, sets } } };
    });
  };

  const deleteSet = (setId: ID) => {
    if (!currentFileId) return;
    if (!confirm("この数式を削除しますか？")) return;
    setStore((s) => {
      const f = s.files[currentFileId];
      if (!f) return s;
      const sets = f.sets.filter((st) => st.id !== setId);
      return {
        ...s,
        files: { ...s.files, [currentFileId]: { ...f, sets } },
      };
    });
  };

  const toggleReveal = (setId: ID) => {
    setRevealMap((prev) => ({ ...prev, [setId]: !prev[setId] }));
  };

  // ---------- UI ----------
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* 左：フォルダ構造 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">数学公式</h2>

        <div className="mb-3 text-xs text-gray-600">
          <div className="mb-1 font-medium">現在のフォルダ</div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() =>
                setStore((s) => ({
                  ...s,
                  currentFolderId: null,
                  currentFileId: null,
                }))
              }
              className={`text-xs rounded-lg px-2 py-1 ${
                currentFolderId === null
                  ? "bg-black text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              ルート
            </button>
            {breadcrumb.map((b) => (
              <span key={b.id} className="flex items-center gap-1">
                <span className="text-gray-400">/</span>
                <button
                  onClick={() => openFolder(b.id)}
                  className={`text-xs rounded-lg px-2 py-1 ${
                    currentFolderId === b.id
                      ? "bg-black text-white"
                      : "bg-gray-100 hover:bg-gray-200"
                  }`}
                >
                  {b.name}
                </button>
              </span>
            ))}
          </div>
        </div>

        {currentFolderId !== null && (
          <button
            onClick={goUpFolder}
            className="mb-3 text-xs text-gray-600 underline"
          >
            上のフォルダに戻る
          </button>
        )}

        {/* 子要素 */}
        <div className="mb-3">
          {children.length === 0 ? (
            <p className="text-xs text-gray-500">このフォルダは空です。</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {children.map((n) => (
                <li key={n.id} className="flex items-center justify-between">
                  <button
                    onClick={() =>
                      n.kind === "folder" ? openFolder(n.id) : openFile(n.id)
                    }
                    className={`flex-1 text-left rounded-xl px-3 py-1.5 border ${
                      currentFileId === n.id
                        ? "bg-black text-white"
                        : "bg-white hover:bg-gray-50"
                    }`}
                  >
                    <span className="mr-2 text-xs text-gray-400">
                      {n.kind === "folder" ? "📁" : "📄"}
                    </span>
                    {n.name}
                  </button>
                  <button
                    onClick={() =>
                      n.kind === "folder"
                        ? deleteFolder(n.id)
                        : deleteFile(n.id)
                    }
                    className="text-xs rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 追加フォーム */}
        <div className="border-t pt-3 mt-3 space-y-3">
          <div>
            <h3 className="text-xs font-semibold mb-1">フォルダを追加</h3>
            <div className="flex gap-2">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="flex-1 rounded-xl border px-3 py-2 text-xs"
                placeholder="例: 三角関数 / 積分公式"
              />
              <button
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
                placeholder="例: オイラーの公式"
              />
              <button
                onClick={addFile}
                className="rounded-xl bg-black px-3 py-2 text-xs text-white"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 右：ファイル内容 */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[260px]">
        {!currentFile ? (
          <p className="text-sm text-gray-500">
            左のフォルダからファイルを選んでください。
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-base">
                ファイル: {nodes[currentFile.id]?.name}
              </h2>
              <button
                onClick={addSet}
                className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
              >
                数式を追加
              </button>
            </div>

            {currentFile.sets.length === 0 ? (
              <p className="text-sm text-gray-500">
                まだ数式がありません。「数式を追加」から追加してください。
              </p>
            ) : (
              <div className="space-y-4">
                {currentFile.sets.map((set, idx) => (
                  <div
                    key={set.id}
                    className="rounded-2xl border px-4 py-3 bg-gray-50 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">
                        数式 {idx + 1}
                      </h3>
                      <button
                        onClick={() => deleteSet(set.id)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        削除
                      </button>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-gray-700">
                        タイトル
                      </label>
                      <input
                        value={set.title}
                        onChange={(e) =>
                          updateSet(currentFile.id, set.id, "title", e.target.value)
                        }
                        className="w-full rounded-lg border px-3 py-2 text-xs"
                        placeholder="例：オイラーの公式"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-700">
                          数式
                        </span>
                        <button
                          onClick={() => toggleReveal(set.id)}
                          className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                        >
                          {revealMap[set.id] ? "隠す" : "めくる"}
                        </button>
                      </div>
                      {revealMap[set.id] ? (
                        <MathMarkdown text={set.formula} />
                      ) : (
                        <textarea
                          value={set.formula}
                          onChange={(e) =>
                            updateSet(currentFile.id, set.id, "formula", e.target.value)
                          }
                          rows={3}
                          className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
                          placeholder="例：$$e^{ix} = \cos x + i\sin x$$"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
