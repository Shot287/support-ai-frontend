// src/features/study/math-formulas.tsx
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

type FormulaSet = {
  id: ID;
  title: string;     // 数学公式のタイトル（常に展開）
  formula: string;   // 数学公式（LaTeX）…裏向け表示→「めくる」で表示
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
const DOC_KEY   = "math_formulas_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ------ LaTeX テキスト自動補正（Gemini対策） ------
// 1) ¥ (U+00A5) → \
// 2) $$ ... $$ を前後改行付きのブロックに整形
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

// -------- Store I/O --------
function createDefaultStore(): Store {
  const rootId = uid();
  const root: Node = { id: rootId, name: "数学公式", parentId: null, kind: "folder" };
  return {
    nodes: { [rootId]: root },
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
  try { if (typeof window !== "undefined") localStorage.setItem(LOCAL_KEY, JSON.stringify(store)); } catch {}
}

// -------- Main --------
export default function MathFormulas() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // ツリーの展開状態（code-reading と同様の“折りたたみ可能”挙動）
  // true: 展開, false: 収納
  const [expanded, setExpanded] = useState<Record<ID, boolean>>({});

  // セットごとの「入力エリア」開閉
  type EditState = { formula: boolean };
  const [editMap, setEditMap] = useState<Record<ID, EditState>>({});

  // セットごとの「めくる」表示
  type RevealState = { formula: boolean };
  const [revealMap, setRevealMap] = useState<Record<ID, RevealState>>({});

  // ---- 現在位置 ----
  const currentFolder = store.currentFolderId ? store.nodes[store.currentFolderId] : null;
  const currentFile   = store.currentFileId   ? store.files[store.currentFileId] ?? null : null;

  // ---- 永続化（localStorage + /api/docs）----
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
    (async () => {
      try { await saveUserDoc<Store>(DOC_KEY, store); }
      catch (e) { console.warn("[math-formulas] saveUserDoc failed:", e); }
    })();
  }, [store]);

  // 初回：サーバから最新版取得
  useEffect(() => {
    (async () => {
      try {
        const remote = await loadUserDoc<Store>(DOC_KEY);
        if (remote && remote.version === 1) {
          setStore(remote);
          saveLocal(remote);
          // ルートと現在パスは展開
          setTimeout(() => primeExpand(remote), 0);
        } else if (!remote) {
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
          setTimeout(() => primeExpand(storeRef.current), 0);
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
          setTimeout(() => primeExpand(fallback), 0);
        }
      } catch (e) {
        console.warn("[math-formulas] loadUserDoc failed:", e);
        setTimeout(() => primeExpand(storeRef.current), 0);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初期展開：ルート + 現在フォルダまでの経路
  const primeExpand = (s: Store) => {
    const next: Record<ID, boolean> = {};
    const rootIds = Object.values(s.nodes).filter(n => n.parentId === null).map(n => n.id);
    rootIds.forEach(id => { next[id] = true; });
    if (s.currentFolderId) {
      let cur: Node | undefined | null = s.nodes[s.currentFolderId];
      while (cur) {
        next[cur.id] = true;
        cur = cur.parentId ? s.nodes[cur.parentId] : undefined;
      }
    }
    setExpanded(next);
  };

  // ---- ツリー helpers ----
  const rootNodes = useMemo(
    () => Object.values(store.nodes).filter((n) => n.parentId === null),
    [store.nodes]
  );
  const childrenOf = (parentId: ID) =>
    Object.values(store.nodes).filter((n) => n.parentId === parentId);

  const toggleExpand = (id: ID) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const selectFolder = (id: ID) => {
    setStore((s) => ({ ...s, currentFolderId: id }));
    setExpanded((prev) => ({ ...prev, [id]: true }));
  };
  const selectFile = (id: ID) => setStore((s) => ({ ...s, currentFileId: id }));

  const addFolder = () => {
    if (!store.currentFolderId) return;
    const id = uid();
    const node: Node = { id, name: "新しいフォルダ", parentId: store.currentFolderId, kind: "folder" };
    setStore((s) => ({
      ...s,
      nodes: { ...s.nodes, [id]: node },
    }));
    setExpanded((prev) => ({ ...prev, [store.currentFolderId!]: true, [id]: true }));
  };

  const addFile = () => {
    if (!store.currentFolderId) return;
    const fileNodeId = uid();
    const fileNode: Node = { id: fileNodeId, name: "新しいファイル", parentId: store.currentFolderId, kind: "file" };
    const fileData: FileData = { id: fileNodeId, sets: [] };
    setStore((s) => ({
      ...s,
      nodes: { ...s.nodes, [fileNodeId]: fileNode },
      files: { ...s.files, [fileNodeId]: fileData },
      currentFileId: fileNodeId,
    }));
    setExpanded((prev) => ({ ...prev, [store.currentFolderId!]: true }));
  };

  const renameNode = (id: ID) => {
    const node = store.nodes[id];
    if (!node) return;
    const name = window.prompt("新しい名前を入力してください", node.name);
    if (!name) return;
    setStore((s) => ({
      ...s,
      nodes: { ...s.nodes, [id]: { ...s.nodes[id], name } },
    }));
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

    setExpanded((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  // ---- セット操作 ----
  const addSet = () => {
    if (!currentFile) return;
    const newSet: FormulaSet = { id: uid(), title: "", formula: "" };
    setStore((s) => ({
      ...s,
      files: {
        ...s.files,
        [currentFile.id]: { ...s.files[currentFile.id], sets: [...(s.files[currentFile.id]?.sets ?? []), newSet] },
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
    if (!confirm("このセットを削除しますか？")) return;
    setStore((s) => {
      const file = s.files[currentFile.id];
      if (!file) return s;
      const sets = file.sets.filter((st) => st.id !== setId);
      return { ...s, files: { ...s.files, [currentFile.id]: { ...file, sets } } };
    });
    setEditMap((m) => { const c = { ...m }; delete c[setId]; return c; });
    setRevealMap((m) => { const c = { ...m }; delete c[setId]; return c; });
  };

  const toggleEdit = (setId: ID, key: keyof EditState) =>
    setEditMap((prev) => ({ ...prev, [setId]: { ...(prev[setId] ?? { formula: false }), [key]: !((prev[setId]?.[key]) ?? false) } }));

  const toggleReveal = (setId: ID, key: keyof RevealState) =>
    setRevealMap((prev) => ({ ...prev, [setId]: { ...(prev[setId] ?? { formula: false }), [key]: !((prev[setId]?.[key]) ?? false) } }));

  // ---- パンくず ----
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

  // ---- ツリー描画（折りたたみ可能：code-reading風）----
  const renderTree = (node: Node, depth: number) => {
    const children = childrenOf(node.id);
    const isOpen = !!expanded[node.id];
    return (
      <div key={node.id}>
        <div className="flex items-center gap-1 py-0.5">
          {node.kind === "folder" ? (
            <>
              <button
                type="button"
                onClick={() => toggleExpand(node.id)}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 text-xs"
                title={isOpen ? "閉じる" : "開く"}
              >
                {isOpen ? "▾" : "▸"}
              </button>
              <button
                type="button"
                onClick={() => selectFolder(node.id)}
                className={
                  "rounded-lg px-2 py-1 text-sm flex-1 text-left " +
                  (store.currentFolderId === node.id ? "bg-black text-white" : "hover:bg-gray-100")
                }
                style={{ paddingLeft: Math.min(depth * 12, 36) + 8 }}
              >
                📂 {node.name}
              </button>
              <button className="text-xs text-gray-500 hover:underline" onClick={() => renameNode(node.id)}>名称変更</button>
              {node.parentId !== null && (
                <button className="text-xs text-red-500 hover:underline" onClick={() => deleteNode(node.id)}>削除</button>
              )}
            </>
          ) : (
            <>
              <span className="w-5 h-5" />
              <button
                type="button"
                onClick={() => selectFile(node.id)}
                className={
                  "rounded-lg px-2 py-1 text-sm flex-1 text-left " +
                  (store.currentFileId === node.id ? "bg-blue-600 text-white" : "hover:bg-gray-100")
                }
                style={{ paddingLeft: Math.min(depth * 12, 36) + 8 }}
              >
                📄 {node.name}
              </button>
              <button className="text-xs text-gray-500 hover:underline" onClick={() => renameNode(node.id)}>名称変更</button>
              <button className="text-xs text-red-500 hover:underline" onClick={() => deleteNode(node.id)}>削除</button>
            </>
          )}
        </div>

        {/* 子ノード：開いている時だけ描画 */}
        {node.kind === "folder" && isOpen && (
          <div className="ml-4">
            {children.map((child) => renderTree(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* 左：フォルダ／ファイルツリー */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">数学公式 フォルダー</h2>

        {/* パンくず */}
        <div className="mb-3 text-xs text-gray-500 flex flex-wrap gap-1">
          {breadcrumb.map((node, idx) => (
            <span key={node.id} className="flex items-center gap-1">
              {idx > 0 && <span>/</span>}
              <button
                type="button"
                className={"hover:underline " + (idx === breadcrumb.length - 1 ? "font-semibold" : "")}
                onClick={() => node.kind === "folder" ? selectFolder(node.id) : selectFile(node.id)}
              >
                {node.name}
              </button>
            </span>
          ))}
        </div>

        {/* ツリー（折りたたみ可） */}
        <div className="mb-4 max-h-[360px] overflow-auto text-sm">
          {rootNodes.map((n) => renderTree(n, 0))}
        </div>

        {/* 操作ボタン */}
        <div className="space-y-2 border-t pt-3 mt-3">
          <button type="button" onClick={addFolder} className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            ＋ フォルダを追加
          </button>
          <button type="button" onClick={addFile} className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            ＋ ファイルを追加
          </button>
        </div>
      </section>

      {/* 右：ファイル内の公式セット */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[200px]">
        {!currentFile ? (
          <p className="text-sm text-gray-500">左のツリーからファイルを選択してください。</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">
                ファイル：「{store.nodes[currentFile.id]?.name ?? "（名称未設定）"}」
              </h2>
              <button type="button" onClick={addSet} className="rounded-xl bg-black px-3 py-2 text-sm text-white">
                ＋ 数学公式を追加
              </button>
            </div>

            {currentFile.sets.length === 0 ? (
              <p className="text-sm text-gray-500">まだセットがありません。「＋ 数学公式を追加」から、タイトルと公式を追加してください。</p>
            ) : (
              <div className="space-y-4">
                {currentFile.sets.map((set, idx) => {
                  const edit = editMap[set.id] ?? { formula: false };
                  const rev  = revealMap[set.id] ?? { formula: false };
                  return (
                    <div key={set.id} className="rounded-2xl border px-4 py-3 bg-white space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">セット {idx + 1}</h3>
                        <button
                          type="button"
                          onClick={() => deleteSet(set.id)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          セット削除
                        </button>
                      </div>

                      {/* タイトル（常に展開） */}
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-700">数学公式のタイトル</label>
                        <input
                          value={set.title}
                          onChange={(e) => updateSet(set.id, (prev) => ({ ...prev, title: e.target.value }))}
                          className="w-full rounded-lg border px-3 py-2 text-xs"
                          placeholder="例）複素指数関数のオイラーの公式"
                        />
                      </div>

                      {/* 数学公式（裏向け→「めくる」） */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-gray-700">数学公式</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => toggleEdit(set.id, "formula")}
                              className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                            >
                              {edit.formula ? "入力を隠す" : "入力を開く"}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleReveal(set.id, "formula")}
                              className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                            >
                              {rev.formula ? "隠す" : "めくる"}
                            </button>
                          </div>
                        </div>

                        {edit.formula && (
                          <textarea
                            value={set.formula}
                            onChange={(e) => updateSet(set.id, (prev) => ({ ...prev, formula: e.target.value }))}
                            rows={3}
                            className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
                            placeholder="例）オイラーの公式：$$e^{ix}=\cos x+i\sin x$$"
                          />
                        )}

                        <div className="mt-2 rounded-xl border px-3 py-2 bg-gray-50">
                          {rev.formula ? (
                            <MathMarkdown text={set.formula} />
                          ) : (
                            <p className="text-xs text-gray-400">（裏面）「めくる」で公式を表示します（KaTeX + 自動補正）。</p>
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
