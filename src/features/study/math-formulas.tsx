"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
// ※ KaTeX の CSS は app/layout.tsx か globals.css で読み込んでください
// 例) import "katex/dist/katex.min.css";

type ID = string;

/* ===== ツリー構造（数学論理展開と同等） ===== */
type NodeKind = "folder" | "file";
type Node = { id: ID; name: string; parentId: ID | null; kind: NodeKind };

/* ===== 数学公式データ =====
   1つの「セット」= タイトル + 複数の数学公式（ノート）
*/
type FormulaNote = { id: ID; text: string };
type FormulaSet = {
  id: ID;
  title: string;
  formulas: FormulaNote[];
};

type FileData = { id: ID; sets: FormulaSet[] };

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
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/* ===== LaTeX 自動補正（Gemini対策） =====
   1) ¥ → \
   2) $$...$$ を前後改行付きブロックへ
*/
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
    return (
      <p className="text-xs text-gray-400 italic">
        まだ内容がありません。編集して保存してください。
      </p>
    );
  }
  return (
    <div className="prose max-w-none prose-sm">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

/* ===== ストア ===== */
function createDefaultStore(): Store {
  const rootId = uid();
  return {
    nodes: {
      [rootId]: { id: rootId, name: "数学公式", parentId: null, kind: "folder" },
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
    const def = createDefaultStore();
    return {
      nodes: parsed?.nodes ?? def.nodes,
      files: parsed?.files ?? {},
      currentFolderId: parsed?.currentFolderId ?? def.currentFolderId,
      currentFileId: parsed?.currentFileId ?? null,
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
  } catch {}
}

/* ===== メイン ===== */
export default function MathFormulas() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // 「めくる」状態（各数式ノート単位）
  type RevealMap = Record<ID, boolean>;
  // 入力欄の開閉（タイトルは常に展開、数式ノートの入力欄だけトグル）
  type EditMap = Record<ID, boolean>;
  const [revealMap, setRevealMap] = useState<RevealMap>({});
  const [editMap, setEditMap] = useState<EditMap>({});

  const currentFolder = store.currentFolderId
    ? store.nodes[store.currentFolderId]
    : null;
  const currentFile = store.currentFileId
    ? store.files[store.currentFileId] ?? null
    : null;

  // 保存
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
    (async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, store);
      } catch (e) {
        console.warn("[math-formulas] saveUserDoc failed:", e);
      }
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
          const def = createDefaultStore();
          const fallback: Store = {
            nodes: (remote as any).nodes ?? def.nodes,
            files: (remote as any).files ?? {},
            currentFolderId: (remote as any).currentFolderId ?? def.currentFolderId,
            currentFileId: (remote as any).currentFileId ?? null,
            version: 1,
          };
          setStore(fallback);
          saveLocal(fallback);
          await saveUserDoc<Store>(DOC_KEY, fallback);
        }
      } catch (e) {
        console.warn("[math-formulas] loadUserDoc failed:", e);
      }
    })();
  }, []);

  /* ===== ツリー ===== */
  const rootNodes = useMemo(
    () => Object.values(store.nodes).filter((n) => n.parentId === null),
    [store.nodes]
  );
  const childrenOf = (parentId: ID) =>
    Object.values(store.nodes).filter((n) => n.parentId === parentId);

  const selectFolder = (id: ID) =>
    setStore((s) => ({ ...s, currentFolderId: id }));
  const selectFile = (id: ID) =>
    setStore((s) => ({ ...s, currentFileId: id }));

  const addFolder = () => {
    if (!store.currentFolderId) return;
    const id = uid();
    const node: Node = { id, name: "新しいフォルダ", parentId: store.currentFolderId, kind: "folder" };
    setStore((s) => ({ ...s, nodes: { ...s.nodes, [id]: node } }));
  };

  const addFile = () => {
    if (!store.currentFolderId) return;
    const fileId = uid();
    const fileNode: Node = { id: fileId, name: "新しいファイル", parentId: store.currentFolderId, kind: "file" };
    const fileData: FileData = { id: fileId, sets: [] };
    setStore((s) => ({
      ...s,
      nodes: { ...s.nodes, [fileId]: fileNode },
      files: { ...s.files, [fileId]: fileData },
      currentFileId: fileId,
    }));
  };

  const renameNode = (id: ID) => {
    const node = store.nodes[id];
    if (!node) return;
    const name = window.prompt("新しい名前を入力してください", node.name);
    if (!name) return;
    setStore((s) => ({ ...s, nodes: { ...s.nodes, [id]: { ...s.nodes[id], name } } }));
  };

  const deleteNode = (id: ID) => {
    const node = store.nodes[id];
    if (!node) return;
    if (!confirm(`「${node.name}」を削除します。配下のファイル／フォルダも削除されます。よろしいですか？`)) return;

    setStore((s) => {
      const nodes = { ...s.nodes };
      const files = { ...s.files };
      const removeRecursively = (targetId: ID) => {
        const n = nodes[targetId];
        if (!n) return;
        for (const child of Object.values(nodes)) {
          if (child.parentId === targetId) removeRecursively(child.id);
        }
        if (n.kind === "file") delete files[targetId];
        delete nodes[targetId];
      };
      removeRecursively(id);

      let currentFolderId = s.currentFolderId;
      let currentFileId = s.currentFileId;
      if (currentFolderId && !nodes[currentFolderId]) {
        currentFolderId = Object.values(nodes).find((n) => n.parentId === null)?.id ?? null;
      }
      if (currentFileId && !files[currentFileId]) currentFileId = null;

      return { ...s, nodes, files, currentFolderId, currentFileId };
    });
  };

  /* ===== セット & 数式ノート操作 ===== */
  const addSet = () => {
    if (!currentFile) return;
    const newSet: FormulaSet = { id: uid(), title: "", formulas: [] };
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

  const updateSet = (setId: ID, updater: (prev: FormulaSet) => FormulaSet) => {
    if (!currentFile) return;
    setStore((s) => {
      const file = s.files[currentFile.id];
      if (!file) return s;
      const sets = file.sets.map((st) => (st.id === setId ? updater(st) : st));
      return { ...s, files: { ...s.files, [currentFile.id]: { ...file, sets } } };
    });
  };

  const deleteSet = (setId: ID) => {
    if (!currentFile) return;
    if (!confirm("このセット（タイトル）を削除しますか？")) return;
    setStore((s) => {
      const file = s.files[currentFile.id];
      if (!file) return s;
      const sets = file.sets.filter((st) => st.id !== setId);
      return { ...s, files: { ...s.files, [currentFile.id]: { ...file, sets } } };
    });
  };

  const addFormula = (setId: ID) =>
    updateSet(setId, (prev) => ({
      ...prev,
      formulas: [...prev.formulas, { id: uid(), text: "" }],
    }));

  const updateFormula = (setId: ID, noteId: ID, text: string) =>
    updateSet(setId, (prev) => ({
      ...prev,
      formulas: prev.formulas.map((n) => (n.id === noteId ? { ...n, text } : n)),
    }));

  const deleteFormula = (setId: ID, noteId: ID) =>
    updateSet(setId, (prev) => ({
      ...prev,
      formulas: prev.formulas.filter((n) => n.id !== noteId),
    }));

  const toggleReveal = (noteId: ID) =>
    setRevealMap((m) => ({ ...m, [noteId]: !m[noteId] }));

  const toggleEdit = (noteId: ID) =>
    setEditMap((m) => ({ ...m, [noteId]: !m[noteId] }));

  /* ===== パンくず ===== */
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

  /* ===== ツリー描画（数学論理展開と同じ操作感） ===== */
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
                  (store.currentFolderId === node.id ? "bg-black text-white" : "hover:bg-gray-100")
                }
              >
                📂 {node.name}
              </button>
              <button className="text-xs text-gray-500 hover:underline" onClick={() => renameNode(node.id)}>
                名称変更
              </button>
              {node.parentId !== null && (
                <button className="text-xs text-red-500 hover:underline" onClick={() => deleteNode(node.id)}>
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
                  (store.currentFileId === node.id ? "bg-blue-600 text-white" : "hover:bg-gray-100")
                }
              >
                📄 {node.name}
              </button>
              <button className="text-xs text-gray-500 hover:underline" onClick={() => renameNode(node.id)}>
                名称変更
              </button>
              <button className="text-xs text-red-500 hover:underline" onClick={() => deleteNode(node.id)}>
                削除
              </button>
            </>
          )}
        </div>
        {children.map((c) => renderTree(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* 左：ツリー */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">数学公式 フォルダー</h2>

        {/* パンくず */}
        <div className="mb-3 text-xs text-gray-500 flex flex-wrap gap-1">
          {breadcrumb.map((node, i) => (
            <span key={node.id} className="flex items-center gap-1">
              {i > 0 && <span>/</span>}
              <button
                className={"hover:underline " + (i === breadcrumb.length - 1 ? "font-semibold" : "")}
                onClick={() => (node.kind === "folder" ? selectFolder(node.id) : selectFile(node.id))}
              >
                {node.name}
              </button>
            </span>
          ))}
        </div>

        {/* ツリー */}
        <div className="mb-4 max-h-[360px] overflow-auto text-sm">{rootNodes.map((n) => renderTree(n, 0))}</div>

        {/* 操作 */}
        <div className="space-y-2 border-t pt-3 mt-3">
          <button onClick={addFolder} className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            ＋ フォルダを追加
          </button>
          <button onClick={addFile} className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            ＋ ファイルを追加
          </button>
        </div>
      </section>

      {/* 右：ファイル内 */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[200px]">
        {!currentFile ? (
          <p className="text-sm text-gray-500">左のツリーからファイルを選択してください。</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">
                ファイル：「{store.nodes[currentFile.id]?.name ?? "（名称未設定）"}」
              </h2>
              <button onClick={addSet} className="rounded-xl bg-black px-3 py-2 text-sm text-white">
                ＋ セット（タイトル）を追加
              </button>
            </div>

            {currentFile.sets.length === 0 ? (
              <p className="text-sm text-gray-500">
                まだセットがありません。「＋ セット（タイトル）を追加」から作成してください。
              </p>
            ) : (
              <div className="space-y-4">
                {currentFile.sets.map((set, sIdx) => (
                  <div key={set.id} className="rounded-2xl border px-4 py-3 bg-white space-y-3">
                    {/* タイトル：常に展開 */}
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">セット {sIdx + 1}</h3>
                      <button
                        className="text-xs text-red-500 hover:underline"
                        onClick={() => deleteSet(set.id)}
                      >
                        セット削除
                      </button>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-gray-700">数学公式のタイトル</label>
                      <input
                        value={set.title}
                        onChange={(e) =>
                          updateSet(set.id, (prev) => ({ ...prev, title: e.target.value }))
                        }
                        placeholder="例：オイラーの公式、正弦定理、等比数列の和 など"
                        className="w-full rounded-lg border px-3 py-2 text-xs"
                      />
                    </div>

                    {/* 数式ノート群：裏向け表示＆入力トグル */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-700">数学公式（複数可）</span>
                        <button
                          onClick={() => addFormula(set.id)}
                          className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                        >
                          ＋ 数学公式を追加
                        </button>
                      </div>

                      {set.formulas.length === 0 ? (
                        <p className="text-xs text-gray-500">まだ公式がありません。「＋ 数学公式を追加」から入力してください。</p>
                      ) : (
                        <div className="space-y-3">
                          {set.formulas.map((note, nIdx) => {
                            const revealed = !!revealMap[note.id];
                            const editing = !!editMap[note.id];
                            return (
                              <div key={note.id} className="rounded-xl border p-3 bg-gray-50">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-xs text-gray-600">#{nIdx + 1}</div>
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => toggleEdit(note.id)}
                                      className="text-xs rounded-lg border px-2 py-1 bg-white hover:bg-gray-50"
                                    >
                                      {editing ? "入力を隠す" : "入力を開く"}
                                    </button>
                                    <button
                                      onClick={() => toggleReveal(note.id)}
                                      className="text-xs rounded-lg border px-2 py-1 bg-white hover:bg-gray-50"
                                    >
                                      {revealed ? "隠す" : "めくる"}
                                    </button>
                                    <button
                                      onClick={() => deleteFormula(set.id, note.id)}
                                      className="text-xs text-red-500 hover:underline ml-1"
                                      title="この公式を削除"
                                    >
                                      削除
                                    </button>
                                  </div>
                                </div>

                                {editing && (
                                  <textarea
                                    value={note.text}
                                    onChange={(e) => updateFormula(set.id, note.id, e.target.value)}
                                    rows={3}
                                    className="mt-2 w-full rounded-lg border px-3 py-2 text-xs font-mono bg-white"
                                    placeholder="数式をLaTeXで入力（¥→\ や $$...$$ は自動補正されます）"
                                  />
                                )}

                                <div className="mt-2 rounded-xl border bg-white px-3 py-2">
                                  {revealed ? (
                                    <MathMarkdown text={note.text} />
                                  ) : (
                                    <p className="text-[11px] text-gray-400">
                                      （裏面）「めくる」で表示します。
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
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
