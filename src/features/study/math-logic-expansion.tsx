// src/features/study/math-logic-expansion.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";

// --- Markdown & LaTeX Libraries ---
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

// remark-gfmの読み込みエラー対策
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import remarkGfm from "remark-gfm";

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
  problemText: string;
  myNote: string; // ここはプレーンテキスト扱い
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
  promptConfig?: {
    transcribe: string;
    solve: string;
  };
};

// ------------------------------------------
// Constants & Helpers
// ------------------------------------------
const LOCAL_KEY = "math_logic_expansion_v1";
const DOC_KEY = "math_logic_expansion_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ▼▼▼ 指示文のデフォルト設定 ▼▼▼
const DEFAULT_PROMPT_TRANSCRIBE = `添付した画像の「数学の問題文」を、一言一句正確に文字起こししてください。
解答や解説は不要です。**問題文のテキストデータのみ**を出力してください。

自作アプリに保存するため、**以下の出力フォーマットを厳守**してください。

【出力ルール】
1. **全体**: 出力すべてをひとつの **Markdown形式のコードブロック**（\`\`\`markdown ... \`\`\`）の中に収めてください。
2. **数式**: LaTeX記法を使用してください。
   - 文中の数式は \`$\` で囲む（例: \`$x^2$\`）。
   - 独立した行の数式は \`$$\` で囲む（例: \`$$ y = ax $$\`）。
   - \`\\[ ... \\]\` は**使用禁止**です。
3. **空欄・解答欄（重要）**:
   - 問題文中の「ア」や「61」などの解答欄は、**文中にある場合でも必ず数式モード**として扱い、\`$\` で囲んでください。
   - 正しい例: \`$A$ と $B$ は $\\fbox{61}$ である\`
   - 悪い例: \`$A$ と $B$ は \\fbox{61} である\`
4. **表**: LaTeXの \`\\begin{tabular}\` 環境は**使用禁止**です。
   - 表が必要な場合は、必ず **Markdownの表組み記法**（\`| ヘッダー |\`）を使用してください。
5. **見出し**: \`\\section\` などのコマンドは使わず、Markdownの見出し（\`##\`, \`###\`）を使用してください。`;

const DEFAULT_PROMPT_SOLVE = `以下の数学の問題について、詳細な「解答・解説」と「途中式」を作成してください。

自作アプリに保存するため、**以下の出力フォーマットを厳守**してください。

【出力ルール】
1. **全体**: 出力すべてをひとつの **Markdown形式のコードブロック**（\`\`\`markdown ... \`\`\`）の中に収めてください。
2. **数式**: LaTeX記法を使用してください。
   - 文中の数式は \`$\` で囲む。
   - 独立した行の数式は \`$$\` で囲む。
   - \`\\[ ... \\]\` は**使用禁止**です。
3. **強調・答え**:
   - 最終的な答えや重要な部分は、\`$\\fbox{...}$\` （数式モードの枠）で囲むか、太字 \`**...**\` を使用してください。
4. **表**: \`\\begin{tabular}\` は使用せず、Markdownの表組み（\`| ... |\`）を使用してください。

---
【問題文】
（ここにさっき文字起こししたテキストを貼り付けてください）`;

// ------ LaTeX / Markdown テキスト自動補正 ------
function normalizeMathText(raw: string): string {
  if (!raw) return "";
  let text = raw;
  text = text.replace(/¥/g, "\\");
  text = text.replace(/\\section\*?\{(.*?)\}/g, "\n## $1\n");
  text = text.replace(/\\subsection\*?\{(.*?)\}/g, "\n### $1\n");
  text = text.replace(/\\textbf\{(.*?)\}/g, "**$1**");
  text = text.replace(/\\textit\{(.*?)\}/g, "*$1*");
  text = text.replaceAll("\\[", "\n$$\n");
  text = text.replaceAll("\\]", "\n$$\n");
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_match, inner) => `\n$$\n${inner.trim()}\n$$\n`);
  
  const envs = ["align", "align*", "equation", "equation*", "cases", "gather", "matrix", "pmatrix", "bmatrix"];
  envs.forEach((env) => {
    const regex = new RegExp(`(^|\\n)(\\\\begin\\{${env}\\}[\\s\\S]*?\\\\end\\{${env}\\})`, "g");
    text = text.replace(regex, "$1\n$$\n$2\n$$\n");
  });
  return text;
}

// -------- Helper Functions --------
function createDefaultStore(): Store {
  const rootId = uid();
  const rootNode: Node = { id: rootId, name: "数学・論理", parentId: null, kind: "folder" };
  return {
    nodes: { [rootId]: rootNode },
    files: {},
    currentFolderId: rootId,
    currentFileId: null,
    version: 1,
    promptConfig: { transcribe: DEFAULT_PROMPT_TRANSCRIBE, solve: DEFAULT_PROMPT_SOLVE },
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
      promptConfig: parsed.promptConfig ?? def.promptConfig,
    };
  } catch { return createDefaultStore(); }
}

function saveLocal(store: Store) {
  try {
    if (typeof window !== "undefined") localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
  } catch { /* 無視 */ }
}

// -------- MathMarkdown コンポーネント --------
function MathMarkdown({ text, placeholder }: { text: string; placeholder?: string }) {
  const normalized = normalizeMathText(text);
  if (!normalized.trim()) return <p className="text-xs text-gray-400 italic">{placeholder || "まだ内容がありません。"}</p>;

  return (
    <div className="
      text-sm leading-relaxed text-gray-800
      [&_p]:my-2
      [&_h1]:text-xl [&_h1]:font-bold [&_h1]:my-4 [&_h1]:pb-2 [&_h1]:border-b
      [&_h2]:text-lg [&_h2]:font-bold [&_h2]:my-3 [&_h2]:pb-1 [&_h2]:border-b
      [&_h3]:text-base [&_h3]:font-bold [&_h3]:my-2
      [&_table]:w-full [&_table]:border-collapse [&_table]:my-4 [&_table]:border [&_table]:border-gray-300
      [&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-100 [&_th]:p-2 [&_th]:text-center [&_th]:font-semibold
      [&_td]:border [&_td]:border-gray-300 [&_td]:p-2 [&_td]:text-center
      [&_a]:text-blue-600 [&_a]:underline
      [&_hr]:my-4 [&_hr]:border-gray-300
    ">
      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]} components={{ p: ({ children }) => <div className="mb-2 leading-relaxed">{children}</div> }}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

// -------- SectionItem コンポーネント (LaTeX対応版) --------
type SectionItemProps = {
  label: string;
  value: string;
  isEditing: boolean;
  isRevealed: boolean;
  onToggleEdit: () => void;
  onToggleReveal?: () => void;
  onChange: (val: string) => void;
  placeholder?: string;
  copyPromptText?: string;
  copyButtonLabel?: string;
};

function SectionItem({
  label,
  value,
  isEditing,
  isRevealed,
  onToggleEdit,
  onToggleReveal,
  onChange,
  placeholder,
  copyPromptText,
  copyButtonLabel,
}: SectionItemProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!copyPromptText) return;
    try {
      await navigator.clipboard.writeText(copyPromptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) { console.error("Failed to copy:", err); }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 border-b pb-1 border-gray-100">
        <span className="text-sm font-bold text-gray-700">{label}</span>
        <div className="flex items-center gap-2">
          {copyPromptText && (
            <button
              type="button"
              onClick={handleCopy}
              className={`text-xs rounded px-2 py-1 border transition-colors flex items-center gap-1 ${
                copied ? "bg-green-50 text-green-600 border-green-200" : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              <span>{copied ? "コピー完了" : (copyButtonLabel || "指示文コピー")}</span>
              {!copied && <span className="text-[10px]">📋</span>}
            </button>
          )}
          <button
            type="button"
            onClick={onToggleEdit}
            className={`text-xs rounded px-2 py-1 border transition-colors ${
              isEditing ? "bg-blue-50 text-blue-600 border-blue-200" : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            {isEditing ? "完了(プレビュー)" : "編集(LaTeX)"}
          </button>
          {onToggleReveal && (
            <button
              type="button"
              onClick={onToggleReveal}
              className={`text-xs rounded px-2 py-1 border transition-colors ${
                isRevealed ? "bg-gray-100 text-gray-700" : "bg-black text-white border-black hover:bg-gray-800"
              }`}
            >
              {isRevealed ? "隠す" : "めくる"}
            </button>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            placeholder={placeholder || "LaTeX/Markdownを入力..."}
          />
          <p className="text-[10px] text-gray-400 text-right mt-1">
            ※ ¥は\に自動変換。$..$, $$..$$, \[..\], \section等に対応
          </p>
        </div>
      )}

      <div className={`rounded-xl border px-4 py-3 bg-gray-50/50 min-h-[60px] ${!isEditing ? "block" : "hidden"}`}>
        {!onToggleReveal || isRevealed ? (
          <MathMarkdown text={value} placeholder="（内容がありません）" />
        ) : (
          <div
            onClick={onToggleReveal}
            className="flex items-center justify-center h-full min-h-[80px] cursor-pointer text-gray-400 hover:text-gray-600 hover:bg-gray-100/50 rounded transition-colors"
          >
            <span className="text-xs">ここをクリック または「めくる」で表示</span>
          </div>
        )}
      </div>
    </div>
  );
}

// -------- PlainTextSection コンポーネント (「自分の解釈」用・LaTeX非対応) --------
function PlainTextSection({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 border-b pb-1 border-gray-100">
        <span className="text-sm font-bold text-gray-700">{label}</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-sans focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        placeholder={placeholder || "自分の考えやメモを自由に入力..."}
      />
    </div>
  );
}

// ------------------------------------------
// Main Component
// ------------------------------------------
export default function MathLogicExpansion() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  type RevealState = { ai: boolean; steps: boolean }; // my を削除
  const [revealMap, setRevealMap] = useState<Record<ID, RevealState>>({});

  type EditState = { problem: boolean; ai: boolean; steps: boolean }; // my を削除
  const [editMap, setEditMap] = useState<Record<ID, EditState>>({});

  const [newFolderName, setNewFolderName] = useState("");
  const [newFileName, setNewFileName] = useState("");
  
  const [showConfig, setShowConfig] = useState(false);
  const [tempConfig, setTempConfig] = useState({ transcribe: "", solve: "" });

  const currentFile = store.currentFileId ? store.files[store.currentFileId] ?? null : null;

  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  useEffect(() => {
    const unsubscribe = registerManualSync({
      pull: async () => {
        try {
          const remote = await loadUserDoc<Store>(DOC_KEY);
          if (remote && remote.version === 1) {
            setStore(remote);
            saveLocal(remote);
          }
        } catch (e) { console.warn("PULL failed:", e); }
      },
      push: async () => {
        try {
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        } catch (e) { console.warn("PUSH failed:", e); }
      },
      reset: async () => { /* no-op */ },
    });
    return unsubscribe;
  }, []);

  const nodes = store.nodes;
  const currentFolderId = store.currentFolderId;
  const currentFileId = store.currentFileId;

  const children = useMemo(() => {
    const list = Object.values(nodes).filter((n) => n.parentId === currentFolderId);
    return list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });
  }, [nodes, currentFolderId]);

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
      return {
        ...s,
        nodes: { ...s.nodes, [id]: { id, name, parentId: s.currentFolderId, kind: "folder" } },
      };
    });
    setNewFolderName("");
  };

  const addFile = () => {
    const name = newFileName.trim();
    if (!name) return;
    setStore((s) => {
      const id = uid();
      return {
        ...s,
        nodes: { ...s.nodes, [id]: { id, name, parentId: s.currentFolderId, kind: "file" } },
        files: { ...s.files, [id]: { id, sets: [] } },
        currentFileId: id,
      };
    });
    setNewFileName("");
  };

  const openFolder = (id: ID) => {
    setStore((s) => ({
      ...s,
      currentFolderId: id,
      currentFileId: s.currentFileId && s.nodes[s.currentFileId]?.parentId === id ? s.currentFileId : null,
    }));
  };

  const openFile = (id: ID) => setStore((s) => ({ ...s, currentFileId: id }));

  const goUpFolder = () => {
    if (!currentFolderId) return;
    const cur = nodes[currentFolderId];
    if (!cur) return;
    setStore((s) => ({ ...s, currentFolderId: cur.parentId, currentFileId: null }));
  };

  const renameNode = (id: ID) => {
    const node = store.nodes[id];
    if (!node) return;
    const name = window.prompt("名称変更:", node.name);
    if (!name) return;
    setStore((s) => ({ ...s, nodes: { ...s.nodes, [id]: { ...s.nodes[id], name } } }));
  };

  const deleteNodeRecursive = (id: ID) => {
    const node = store.nodes[id];
    if (!confirm(`${node?.kind === "folder" ? "フォルダ" : "ファイル"}を削除しますか？`)) return;
    setStore((s) => {
      const toDelete = new Set<ID>();
      const queue: ID[] = [id];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        toDelete.add(cur);
        for (const n of Object.values(s.nodes)) if (n.parentId === cur) queue.push(n.id);
      }
      const nextNodes: Record<ID, Node> = {};
      const nextFiles: Record<ID, FileData> = {};
      for (const [nid, n] of Object.entries(s.nodes)) if (!toDelete.has(nid)) nextNodes[nid] = n;
      for (const [fid, f] of Object.entries(s.files)) if (!toDelete.has(fid)) nextFiles[fid] = f;
      return {
        ...s,
        nodes: nextNodes,
        files: nextFiles,
        currentFolderId: toDelete.has(s.currentFolderId ?? "") ? null : s.currentFolderId,
        currentFileId: toDelete.has(s.currentFileId ?? "") ? null : s.currentFileId,
      };
    });
  };

  const addSet = () => {
    if (!currentFile) return;
    const newSet: MathSet = { id: uid(), problemText: "", myNote: "", aiNote: "", stepsNote: "" };
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
    setEditMap((prev) => ({ ...prev, [newSet.id]: { problem: true, ai: true, steps: true } }));
  };

  const updateSet = (setId: ID, field: keyof MathSet, value: string) => {
    if (!currentFile) return;
    setStore((s) => {
      const file = s.files[currentFile.id];
      const sets = file.sets.map((st) => (st.id === setId ? { ...st, [field]: value } : st));
      return { ...s, files: { ...s.files, [currentFile.id]: { ...file, sets } } };
    });
  };

  const deleteSet = (setId: ID) => {
    if (!currentFile || !confirm("セットを削除しますか？")) return;
    setStore((s) => {
      const file = s.files[currentFile.id];
      const sets = file.sets.filter((st) => st.id !== setId);
      return { ...s, files: { ...s.files, [currentFile.id]: { ...file, sets } } };
    });
    setRevealMap((prev) => { const c = { ...prev }; delete c[setId]; return c; });
  };

  const toggleReveal = (setId: ID, key: keyof RevealState) => {
    setRevealMap((prev) => {
      const st = prev[setId] ?? { ai: false, steps: false };
      return { ...prev, [setId]: { ...st, [key]: !st[key] } };
    });
  };

  const toggleEdit = (setId: ID, key: keyof EditState) => {
    setEditMap((prev) => {
      const st = prev[setId] ?? { problem: false, ai: false, steps: false };
      return { ...prev, [setId]: { ...st, [key]: !st[key] } };
    });
  };

  const openConfig = () => {
    setTempConfig({
      transcribe: store.promptConfig?.transcribe ?? DEFAULT_PROMPT_TRANSCRIBE,
      solve: store.promptConfig?.solve ?? DEFAULT_PROMPT_SOLVE,
    });
    setShowConfig(true);
  };

  const saveConfig = () => {
    setStore((s) => ({ ...s, promptConfig: tempConfig }));
    setShowConfig(false);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] h-full relative">
      <section className="flex flex-col gap-4 rounded-2xl border p-4 shadow-sm bg-white h-fit">
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-lg">数学・論理ノート</h2>
            <button onClick={openConfig} className="text-gray-400 hover:text-gray-600 text-xs border rounded p-1">⚙️指示文設定</button>
          </div>
          
          <div className="flex flex-wrap items-center gap-1 text-xs mb-4">
            <button
              onClick={() => setStore((s) => ({ ...s, currentFolderId: null, currentFileId: null }))}
              className={`px-2 py-1 rounded ${currentFolderId === null ? "bg-black text-white" : "bg-gray-100 hover:bg-gray-200"}`}
            >
              ROOT
            </button>
            {breadcrumb.map((b) => (
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
              ← 上へ戻る
            </button>
          )}

          <ul className="space-y-1">
            {children.length === 0 && <li className="text-xs text-gray-400 p-2">空です</li>}
            {children.map((n) => (
              <li key={n.id} className="group flex items-center justify-between gap-1">
                <button
                  onClick={() => (n.kind === "folder" ? openFolder(n.id) : openFile(n.id))}
                  className={`flex-1 text-left text-sm px-3 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                    currentFileId === n.id ? "bg-blue-600 text-white shadow-md" : "hover:bg-gray-100 text-gray-700"
                  }`}
                >
                  <span>{n.kind === "folder" ? "📁" : "📄"}</span>
                  <span className="truncate">{n.name}</span>
                </button>
                <div className="hidden group-hover:flex items-center gap-1">
                  <button onClick={() => renameNode(n.id)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">✎</button>
                  <button onClick={() => deleteNodeRecursive(n.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">✕</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        
        <div className="border-t pt-4 space-y-3">
          <div className="flex gap-2">
            <input
              className="flex-1 min-w-0 rounded-lg border px-2 py-1.5 text-xs"
              placeholder="新規フォルダ"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
            />
            <button onClick={addFolder} className="bg-gray-800 text-white text-xs px-3 rounded-lg hover:bg-black whitespace-nowrap">追加</button>
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 min-w-0 rounded-lg border px-2 py-1.5 text-xs"
              placeholder="新規ファイル"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
            />
            <button onClick={addFile} className="bg-gray-800 text-white text-xs px-3 rounded-lg hover:bg-black whitespace-nowrap">追加</button>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border shadow-sm p-6 min-h-[500px]">
        {!currentFile ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <span className="text-4xl mb-2">📄</span>
            <p>ファイルを選択してください</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <h1 className="text-xl font-bold text-gray-800">{nodes[currentFile.id]?.name}</h1>
              <button
                onClick={addSet}
                className="bg-black text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-800 shadow-sm"
              >
                ＋ 問題セット追加
              </button>
            </div>

            {currentFile.sets.length === 0 && (
              <div className="text-center py-10 text-gray-400 bg-gray-50 rounded-xl border border-dashed">
                セットがありません。追加してください。
              </div>
            )}

            {currentFile.sets.map((set, idx) => {
              const edit = editMap[set.id] || { problem: false, ai: false, steps: false };
              const rev = revealMap[set.id] || { ai: false, steps: false };

              return (
                <div key={set.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b flex justify-between items-center">
                    <span className="font-bold text-gray-600">SET #{idx + 1}</span>
                    <button onClick={() => deleteSet(set.id)} className="text-xs text-red-500 hover:underline">
                      削除
                    </button>
                  </div>
                  <div className="p-5 space-y-6">
                    <SectionItem
                      label="問題文"
                      value={set.problemText}
                      isEditing={edit.problem}
                      isRevealed={true} // 常時表示
                      onToggleEdit={() => toggleEdit(set.id, "problem")}
                      onChange={(val) => updateSet(set.id, "problemText", val)}
                      placeholder="問題文を入力... \section{...} や \[ ... \] も自動変換されます"
                      copyPromptText={store.promptConfig?.transcribe ?? DEFAULT_PROMPT_TRANSCRIBE}
                      copyButtonLabel="文字起こし指示"
                    />
                    
                    {/* 自分の解釈 (プレーンテキストのみ) */}
                    <PlainTextSection
                      label="自分の解釈"
                      value={set.myNote}
                      onChange={(val) => updateSet(set.id, "myNote", val)}
                    />
                    
                    <SectionItem
                      label="AI添削"
                      value={set.aiNote}
                      isEditing={edit.ai}
                      isRevealed={rev.ai}
                      onToggleEdit={() => toggleEdit(set.id, "ai")}
                      onToggleReveal={() => toggleReveal(set.id, "ai")}
                      onChange={(val) => updateSet(set.id, "aiNote", val)}
                    />
                    
                    {/* 途中式の欄に「解答解説指示」コピーボタンを移動 */}
                    <SectionItem
                      label="途中式"
                      value={set.stepsNote}
                      isEditing={edit.steps}
                      isRevealed={rev.steps}
                      onToggleEdit={() => toggleEdit(set.id, "steps")}
                      onToggleReveal={() => toggleReveal(set.id, "steps")}
                      onChange={(val) => updateSet(set.id, "stepsNote", val)}
                      copyPromptText={store.promptConfig?.solve ?? DEFAULT_PROMPT_SOLVE}
                      copyButtonLabel="解答・解説指示"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {showConfig && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-2xl p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-4">Geminiへの指示文設定</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  1. 文字起こし指示（「問題文」エリア用）
                </label>
                <textarea
                  className="w-full h-40 border rounded-lg p-3 text-xs font-mono"
                  value={tempConfig.transcribe}
                  onChange={(e) => setTempConfig(prev => ({...prev, transcribe: e.target.value}))}
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  2. 解答・解説指示（「途中式」エリア用）
                </label>
                <textarea
                  className="w-full h-40 border rounded-lg p-3 text-xs font-mono"
                  value={tempConfig.solve}
                  onChange={(e) => setTempConfig(prev => ({...prev, solve: e.target.value}))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowConfig(false)}
                className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={saveConfig}
                className="px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800"
              >
                保存する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}