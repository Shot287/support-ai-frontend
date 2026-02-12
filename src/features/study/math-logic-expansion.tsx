// src/features/study/math-logic-expansion.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";

// --- Markdown & LaTeX Libraries ---
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm"; // テーブル等の対応用（任意）

// ※ KaTeX の CSS は app/layout.tsx かグローバルCSSで読み込んでください。
// 例: import "katex/dist/katex.min.css";

// ------------------------------------------
// Types
// ------------------------------------------
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
  /** 問題文（テキスト / LaTeX 含む） */
  problemText: string;
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

// ------------------------------------------
// Constants & Helpers
// ------------------------------------------
const LOCAL_KEY = "math_logic_expansion_v1";
const DOC_KEY = "math_logic_expansion_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

// ------ LaTeX テキスト自動補正 ------
// 1) ¥ (U+00A5) を \ に変換 (日本語キーボード対応)
// 2) $$ ... $$ を前後改行付きのブロック形式に整える
function normalizeMathText(raw: string): string {
  if (!raw) return "";

  let text = raw;

  // 1) 日本語環境で紛れ込みがちな「¥」をバックスラッシュに変換
  text = text.replace(/¥/g, "\\");

  // 2) $$ ... $$ ブロックを前後改行付きの独立ブロックに整形
  // これによりMarkdownパーサーが数式ブロックとして認識しやすくなります
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_match, inner) => {
    const trimmed = String(inner).trim();
    return `\n$$\n${trimmed}\n$$\n`;
  });

  return text;
}

// -------- MathMarkdown コンポーネント（KaTeX対応） --------
// LaTeXコードをコンパイルして表示するコンポーネント
function MathMarkdown({ text, placeholder }: { text: string; placeholder?: string }) {
  const normalized = normalizeMathText(text);

  if (!normalized.trim()) {
    return (
      <p className="text-xs text-gray-400 italic">
        {placeholder || "まだ内容がありません。"}
      </p>
    );
  }

  return (
    // prose クラスで基本的なタイポグラフィを整える
    <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // 必要に応じてタグのカスタマイズが可能
          p: ({ children }) => <div className="mb-2 leading-relaxed">{children}</div>,
        }}
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
    name: "数学・論理",
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

// ------------------------------------------
// Main Component
// ------------------------------------------
export default function MathLogicExpansion() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // セットごとの「めくる」状態 (表示/非表示)
  type RevealState = {
    my: boolean;
    ai: boolean;
    steps: boolean;
  };
  const [revealMap, setRevealMap] = useState<Record<ID, RevealState>>({});

  // セットごとの「入力エリアを開く/隠す」状態
  type EditState = {
    problem: boolean;
    my: boolean;
    ai: boolean;
    steps: boolean;
  };
  const [editMap, setEditMap] = useState<Record<ID, EditState>>({});

  // 左側：フォルダ／ファイル作成用
  const [newFolderName, setNewFolderName] = useState("");
  const [newFileName, setNewFileName] = useState("");

  const currentFile = store.currentFileId
    ? store.files[store.currentFileId] ?? null
    : null;

  // Store変更 → localStorage 即時保存
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // ---- 手動同期の合図を購読 ----
  useEffect(() => {
    const unsubscribe = registerManualSync({
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
      push: async () => {
        try {
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        } catch (e) {
          console.warn("[math-logic-expansion] manual PUSH failed:", e);
        }
      },
      reset: async () => { /* no-op */ },
    });
    return unsubscribe;
  }, []);

  // ========= フォルダ／ファイル管理 =========
  const nodes = store.nodes;
  const currentFolderId = store.currentFolderId;
  const currentFileId = store.currentFileId;

  // カレントフォルダ直下の children
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

  // パンくずリスト
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
      const node: Node = { id, name, parentId: s.currentFolderId, kind: "folder" };
      return { ...s, nodes: { ...s.nodes, [id]: node } };
    });
    setNewFolderName("");
  };

  const addFile = () => {
    const name = newFileName.trim();
    if (!name) return;
    setStore((s) => {
      const id = uid();
      const node: Node = { id, name, parentId: s.currentFolderId, kind: "file" };
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

  const openFile = (id: ID) => {
    setStore((s) => ({ ...s, currentFileId: id }));
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
      nodes: { ...s.nodes, [id]: { ...s.nodes[id], name } },
    }));
  };

  const deleteNodeRecursive = (id: ID) => {
    const node = store.nodes[id];
    const typeLabel = node?.kind === "folder" ? "フォルダ" : "ファイル";
    if (!confirm(`この${typeLabel}を削除します。中身もすべて消えますがよろしいですか？`)) return;

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

      for (const [nid, n] of Object.entries(s.nodes)) {
        if (!toDelete.has(nid)) nextNodes[nid] = n;
      }
      for (const [fid, f] of Object.entries(s.files)) {
        if (!toDelete.has(fid)) nextFiles[fid] = f;
      }

      return {
        ...s,
        nodes: nextNodes,
        files: nextFiles,
        currentFolderId: toDelete.has(s.currentFolderId ?? "") ? null : s.currentFolderId,
        currentFileId: toDelete.has(s.currentFileId ?? "") ? null : s.currentFileId,
      };
    });
  };

  // ========= セット操作 =========
  const addSet = () => {
    if (!currentFile) return;
    const newSet: MathSet = {
      id: uid(),
      problemText: "",
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
    // 追加直後はエディタを開いた状態にする（UX向上）
    setEditMap(prev => ({
       ...prev, 
       [newSet.id]: { problem: true, my: true, ai: true, steps: true } 
    }));
  };

  const updateSet = (setId: ID, field: keyof MathSet, value: string) => {
    if (!currentFile) return;
    setStore((s) => {
      const file = s.files[currentFile.id];
      if (!file) return s;
      const sets = file.sets.map((st) =>
        st.id === setId ? { ...st, [field]: value } : st
      );
      return {
        ...s,
        files: { ...s.files, [currentFile.id]: { ...file, sets } },
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
        files: { ...s.files, [currentFile.id]: { ...file, sets } },
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
      return { ...prev, [setId]: { ...st, [key]: !st[key] } };
    });
  };

  const toggleEdit = (setId: ID, key: keyof EditState) => {
    setEditMap((prev) => {
      const st = prev[setId] ?? { problem: false, my: false, ai: false, steps: false };
      return { ...prev, [setId]: { ...st, [key]: !st[key] } };
    });
  };

  // ------------------------------------------
  // Render Helpers
  // ------------------------------------------
  const renderSection = (
    label: string,
    setId: ID,
    field: keyof MathSet,
    value: string,
    isEditing: boolean,
    isRevealed: boolean, // 問題文など常時表示したい場合は true を渡す
    toggleEditFn: () => void,
    toggleRevealFn?: () => void,
    placeholder?: string
  ) => {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 border-b pb-1 border-gray-100">
          <span className="text-sm font-bold text-gray-700">{label}</span>
          <div className="flex items-center gap-2">
            {/* エディタ切り替えボタン */}
            <button
              type="button"
              onClick={toggleEditFn}
              className={`text-xs rounded px-2 py-1 border transition-colors ${
                isEditing
                  ? "bg-blue-50 text-blue-600 border-blue-200"
                  : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              {isEditing ? "完了(プレビューへ)" : "編集(LaTeX)"}
            </button>
            
            {/* めくるボタン（機能がある場合のみ） */}
            {toggleRevealFn && (
              <button
                type="button"
                onClick={toggleRevealFn}
                className={`text-xs rounded px-2 py-1 border transition-colors ${
                  isRevealed
                    ? "bg-gray-100 text-gray-700"
                    : "bg-black text-white border-black hover:bg-gray-800"
                }`}
              >
                {isRevealed ? "隠す" : "めくる"}
              </button>
            )}
          </div>
        </div>

        {/* 編集モード: テキストエリア */}
        {isEditing && (
          <div className="animate-in fade-in slide-in-from-top-1 duration-200">
            <textarea
              value={value}
              onChange={(e) => updateSet(setId, field, e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder={placeholder || "LaTeXコードを入力: $x^2$ や $$ ... $$"}
            />
            <p className="text-[10px] text-gray-400 text-right mt-1">
              ※ ¥記号は自動で \ に変換されます
            </p>
          </div>
        )}

        {/* 閲覧モード: コンパイル済み表示 */}
        {/* toggleRevealFnがない(常時表示) または isRevealedがTrue の場合に表示 */}
        <div className={`rounded-xl border px-4 py-3 bg-gray-50/50 min-h-[60px] ${!isEditing ? "block" : "hidden"}`}>
          {(!toggleRevealFn || isRevealed) ? (
            <MathMarkdown text={value} placeholder="（内容がありません。編集ボタンから入力してください）" />
          ) : (
            <div 
              onClick={toggleRevealFn}
              className="flex items-center justify-center h-full min-h-[80px] cursor-pointer text-gray-400 hover:text-gray-600 hover:bg-gray-100/50 rounded transition-colors"
            >
              <span className="text-xs">ここをクリック または「めくる」で表示</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] h-full">
        {/* 左：フォルダツリー */}
        <section className="flex flex-col gap-4 rounded-2xl border p-4 shadow-sm bg-white h-fit">
          <div>
            <h2 className="font-bold text-lg mb-4">数学・論理ノート</h2>
            
            {/* パンくず & ルート */}
            <div className="flex flex-wrap items-center gap-1 text-xs mb-4">
               <button
                 onClick={() => setStore(s => ({...s, currentFolderId: null, currentFileId: null}))}
                 className={`px-2 py-1 rounded ${currentFolderId === null ? "bg-black text-white" : "bg-gray-100 hover:bg-gray-200"}`}
               >
                 ROOT
               </button>
               {breadcrumb.map(b => (
                 <div key={b.id} className="flex items-center gap-1">
                   <span className="text-gray-300">/</span>
                   <button
                     onClick={() => openFolder(b.id)}
                     className={`px-2 py-1 rounded ${currentFolderId === b.id ? "bg-black text-white" : "bg-gray-100 hover:bg-gray-200"}`}
                   >
                     {b.name}
                   </button>
                 </div>
               ))}
            </div>

            {currentFolderId && (
              <button onClick={goUpFolder} className="text-xs text-gray-500 hover:underline mb-2 block">
                ← 上の階層へ戻る
              </button>
            )}

            {/* リスト */}
            <ul className="space-y-1">
              {children.length === 0 && (
                <li className="text-xs text-gray-400 p-2">フォルダは空です</li>
              )}
              {children.map(n => (
                <li key={n.id} className="group flex items-center justify-between gap-1">
                  <button
                    onClick={() => n.kind === "folder" ? openFolder(n.id) : openFile(n.id)}
                    className={`flex-1 text-left text-sm px-3 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                      currentFileId === n.id 
                        ? "bg-blue-600 text-white shadow-md" 
                        : "hover:bg-gray-100 text-gray-700"
                    }`}
                  >
                    <span>{n.kind === "folder" ? "📁" : "📄"}</span>
                    <span className="truncate">{n.name}</span>
                  </button>
                  <div className="hidden group-hover:flex items-center gap-1">
                    <button onClick={() => renameNode(n.id)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                    </button>
                    <button onClick={() => deleteNodeRecursive(n.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t pt-4 space-y-3">
             {/* フォルダ追加 */}
             <div className="flex gap-2">
               <input
                 className="flex-1 min-w-0 rounded-lg border px-2 py-1.5 text-xs"
                 placeholder="新規フォルダ名"
                 value={newFolderName}
                 onChange={e => setNewFolderName(e.target.value)}
               />
               <button onClick={addFolder} className="bg-gray-800 text-white text-xs px-3 rounded-lg hover:bg-black whitespace-nowrap">追加</button>
             </div>
             {/* ファイル追加 */}
             <div className="flex gap-2">
               <input
                 className="flex-1 min-w-0 rounded-lg border px-2 py-1.5 text-xs"
                 placeholder="新規ファイル名"
                 value={newFileName}
                 onChange={e => setNewFileName(e.target.value)}
               />
               <button onClick={addFile} className="bg-gray-800 text-white text-xs px-3 rounded-lg hover:bg-black whitespace-nowrap">追加</button>
             </div>
          </div>
        </section>

        {/* 右：メインコンテンツ */}
        <section className="bg-white rounded-2xl border shadow-sm p-6 min-h-[500px]">
          {!currentFile ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <span className="text-4xl mb-2">📄</span>
              <p>ファイルを選択するか作成してください</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
                <h1 className="text-xl font-bold text-gray-800">
                  {nodes[currentFile.id]?.name}
                </h1>
                <button
                  onClick={addSet}
                  className="bg-black text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-800 transition-shadow shadow-sm"
                >
                  ＋ 問題セットを追加
                </button>
              </div>

              {currentFile.sets.length === 0 && (
                 <div className="text-center py-10 text-gray-400 bg-gray-50 rounded-xl border border-dashed">
                   まだ問題セットがありません。<br/>右上のボタンから追加してください。
                 </div>
              )}

              {currentFile.sets.map((set, idx) => {
                const edit = editMap[set.id] || { problem: false, my: false, ai: false, steps: false };
                const rev = revealMap[set.id] || { my: false, ai: false, steps: false };

                return (
                  <div key={set.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    {/* ヘッダー */}
                    <div className="bg-gray-50 px-4 py-2 border-b flex justify-between items-center">
                      <span className="font-bold text-gray-600">SET #{idx + 1}</span>
                      <button onClick={() => deleteSet(set.id)} className="text-xs text-red-500 hover:text-red-700 hover:underline">
                        削除
                      </button>
                    </div>

                    <div className="p-5 space-y-6">
                      {/* 1. 問題文 (常時表示だがエディタ切替可能) */}
                      {renderSection(
                        "問題文",
                        set.id,
                        "problemText",
                        set.problemText,
                        edit.problem,
                        true, // 問題文は常に「めくられた」状態(プレビュー)とする
                        () => toggleEdit(set.id, "problem"),
                        undefined, // 問題文に「隠す」ボタンは不要
                        "問題文を入力してください。例: 次の定積分を求めよ。$\\int_0^1 x^2 dx$"
                      )}

                      {/* 2. 自分の解釈ノート */}
                      {renderSection(
                        "自分の解釈・解答",
                        set.id,
                        "myNote",
                        set.myNote,
                        edit.my,
                        rev.my,
                        () => toggleEdit(set.id, "my"),
                        () => toggleReveal(set.id, "my"),
                        "自分の考えや解答を入力..."
                      )}

                      {/* 3. AI添削ノート */}
                      {renderSection(
                        "AI添削・フィードバック",
                        set.id,
                        "aiNote",
                        set.aiNote,
                        edit.ai,
                        rev.ai,
                        () => toggleEdit(set.id, "ai"),
                        () => toggleReveal(set.id, "ai"),
                        "AIからのフィードバックを貼り付け..."
                      )}

                      {/* 4. 過程式ノート */}
                      {renderSection(
                        "詳細な途中式・メモ",
                        set.id,
                        "stepsNote",
                        set.stepsNote,
                        edit.steps,
                        rev.steps,
                        () => toggleEdit(set.id, "steps"),
                        () => toggleReveal(set.id, "steps"),
                        "途中計算の過程など..."
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}