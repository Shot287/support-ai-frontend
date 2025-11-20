// src/features/study/math-formulas.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";
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

/** v2: タイトルごとに複数の数式カード */
type FormulaCard = {
  id: ID;
  source: string; // LaTeX / Markdown 数式
};

type TitleSet = {
  id: ID;
  title: string;
  formulas: FormulaCard[];
};

type FileDataV2 = {
  id: ID;
  sets: TitleSet[];
};

type StoreV2 = {
  nodes: Record<ID, Node>;
  files: Record<ID, FileDataV2>;
  currentFolderId: ID | null;
  currentFileId: ID | null;
  version: 2;
};

/** v1 旧型: タイトル 1 つにつき数式 1 つ */
type LegacyFormulaSet = {
  id: ID;
  title: string;
  formula: string;
};

type FileDataV1 = {
  id: ID;
  sets: LegacyFormulaSet[];
};

type StoreV1 = {
  nodes: Record<ID, Node>;
  files: Record<ID, FileDataV1>;
  currentFolderId: ID | null;
  currentFileId: ID | null;
  version: 1;
};

type StoreAny = StoreV1 | StoreV2;

const LOCAL_KEY = "math_formulas_v1";
const DOC_KEY = "math_formulas_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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

// ---------- 初期構成 & マイグレーション ----------
function createDefaultStore(): StoreV2 {
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
    version: 2,
  };
}

function migrateToV2(raw: StoreAny | null | undefined): StoreV2 {
  if (!raw) return createDefaultStore();

  // すでに v2
  if ((raw as StoreV2).version === 2) {
    const v2 = raw as StoreV2;
    return { ...v2, version: 2 };
  }

  // v1 → v2 変換
  const v1 = raw as StoreV1;
  const filesV2: Record<ID, FileDataV2> = {};

  for (const [fileId, file] of Object.entries(v1.files ?? {})) {
    const setsV2: TitleSet[] = (file.sets ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      formulas: [
        {
          id: uid(),
          source: s.formula ?? "",
        },
      ],
    }));
    filesV2[fileId] = {
      id: fileId,
      sets: setsV2,
    };
  }

  return {
    nodes: v1.nodes ?? {},
    files: filesV2,
    currentFolderId: v1.currentFolderId ?? null,
    currentFileId: v1.currentFileId ?? null,
    version: 2,
  };
}

function loadLocal(): StoreV2 {
  try {
    if (typeof window === "undefined") return createDefaultStore();
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createDefaultStore();
    const parsed = JSON.parse(raw) as StoreAny;
    return migrateToV2(parsed);
  } catch {
    return createDefaultStore();
  }
}

function saveLocal(store: StoreV2) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
    }
  } catch {
    // noop
  }
}

// 入力欄 / 表示欄 それぞれの「裏向き状態」
// タイトルも数式カードも、id ごとにこの状態を共有して使う
type RevealState = {
  input: boolean; // true: 表 / false: 裏
  display: boolean;
};

// ---------- メイン ----------
export default function MathFormulas() {
  const [store, setStore] = useState<StoreV2>(() => loadLocal());
  const storeRef = useRef(store);

  const [newFolderName, setNewFolderName] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [revealMap, setRevealMap] = useState<Record<ID, RevealState>>({});

  const currentFolderId = store.currentFolderId;
  const currentFileId = store.currentFileId;

  // ローカル即時保存（サーバ反映は手動同期に任せる）
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // 手動同期登録
  useEffect(() => {
    const unsubscribe = registerManualSync({
      // サーバ → ローカル
      pull: async () => {
        try {
          const remote = await loadUserDoc<StoreAny>(DOC_KEY);
          if (remote) {
            const migrated = migrateToV2(remote);
            setStore(migrated);
            saveLocal(migrated);
          }
        } catch (e) {
          console.warn("[math-formulas] manual PULL failed:", e);
        }
      },
      // ローカル → サーバ
      push: async () => {
        try {
          await saveUserDoc<StoreV2>(DOC_KEY, storeRef.current);
        } catch (e) {
          console.warn("[math-formulas] manual PUSH failed:", e);
        }
      },
      // 今回は RESET なし
      reset: async () => {
        /* no-op */
      },
    });

    return unsubscribe;
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
      const fileData: FileDataV2 = { id, sets: [] };
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

  const openFile = (id: ID) =>
    setStore((s) => ({
      ...s,
      currentFileId: id,
    }));

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
      const nextFiles: Record<ID, FileDataV2> = {};
      for (const [nid, node] of Object.entries(s.nodes)) {
        if (!toDelete.has(nid)) nextNodes[nid] = node;
      }
      for (const [fid, file] of Object.entries(s.files)) {
        if (!toDelete.has(fid)) nextFiles[fid] = file;
      }
      return { ...s, nodes: nextNodes, files: nextFiles, currentFileId: null };
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

  // ---------- タイトル / 数式カード操作 ----------
  const addTitle = () => {
    if (!currentFileId) return;
    setStore((s) => {
      const f = s.files[currentFileId];
      if (!f) return s;
      const newTitle: TitleSet = {
        id: uid(),
        title: "",
        formulas: [
          {
            id: uid(),
            source: "",
          },
        ],
      };
      return {
        ...s,
        files: {
          ...s.files,
          [currentFileId]: { ...f, sets: [...f.sets, newTitle] },
        },
      };
    });
  };

  const updateTitle = (fileId: ID, titleId: ID, value: string) => {
    setStore((s) => {
      const f = s.files[fileId];
      if (!f) return s;
      const sets = f.sets.map((st) =>
        st.id === titleId ? { ...st, title: value } : st
      );
      return { ...s, files: { ...s.files, [fileId]: { ...f, sets } } };
    });
  };

  const deleteTitle = (titleId: ID) => {
    if (!currentFileId) return;
    if (!confirm("このタイトルと中の数式をすべて削除しますか？")) return;
    setStore((s) => {
      const f = s.files[currentFileId];
      if (!f) return s;
      const sets = f.sets.filter((st) => st.id !== titleId);
      return {
        ...s,
        files: { ...s.files, [currentFileId]: { ...f, sets } },
      };
    });
  };

  const addFormula = (titleId: ID) => {
    if (!currentFileId) return;
    setStore((s) => {
      const f = s.files[currentFileId];
      if (!f) return s;
      const sets = f.sets.map((st) =>
        st.id === titleId
          ? {
              ...st,
              formulas: [...st.formulas, { id: uid(), source: "" }],
            }
          : st
      );
      return { ...s, files: { ...s.files, [currentFileId]: { ...f, sets } } };
    });
  };

  const updateFormula = (
    fileId: ID,
    titleId: ID,
    formulaId: ID,
    value: string
  ) => {
    setStore((s) => {
      const f = s.files[fileId];
      if (!f) return s;
      const sets = f.sets.map((st) => {
        if (st.id !== titleId) return st;
        return {
          ...st,
          formulas: st.formulas.map((fm) =>
            fm.id === formulaId ? { ...fm, source: value } : fm
          ),
        };
      });
      return { ...s, files: { ...s.files, [fileId]: { ...f, sets } } };
    });
  };

  const deleteFormula = (titleId: ID, formulaId: ID) => {
    if (!currentFileId) return;
    if (!confirm("この数式カードを削除しますか？")) return;
    setStore((s) => {
      const f = s.files[currentFileId];
      if (!f) return s;
      const sets = f.sets.map((st) => {
        if (st.id !== titleId) return st;
        return {
          ...st,
          formulas: st.formulas.filter((fm) => fm.id !== formulaId),
        };
      });
      return { ...s, files: { ...s.files, [currentFileId]: { ...f, sets } } };
    });
  };

  const getReveal = (id: ID): RevealState => {
    const r = revealMap[id];
    return r ?? { input: false, display: false };
  };

  const toggleInputReveal = (id: ID) => {
    setRevealMap((prev) => {
      const current = prev[id] ?? { input: false, display: false };
      return {
        ...prev,
        [id]: { ...current, input: !current.input },
      };
    });
  };

  const toggleDisplayReveal = (id: ID) => {
    setRevealMap((prev) => {
      const current = prev[id] ?? { input: false, display: false };
      return {
        ...prev,
        [id]: { ...current, display: !current.display },
      };
    });
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
                onClick={addTitle}
                className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
              >
                タイトルを追加
              </button>
            </div>

            {currentFile.sets.length === 0 ? (
              <p className="text-sm text-gray-500">
                まだタイトルがありません。「タイトルを追加」から作成してください。
              </p>
            ) : (
              <div className="space-y-4">
                {currentFile.sets.map((set, idx) => {
                  const rTitle = getReveal(set.id);
                  return (
                    <div
                      key={set.id}
                      className="rounded-2xl border px-4 py-3 bg-gray-50 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">
                          タイトル {idx + 1}
                        </h3>
                        <button
                          onClick={() => deleteTitle(set.id)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          タイトルごと削除
                        </button>
                      </div>

                      {/* タイトル：表（常に表示される表示欄 / Gemini対応） */}
                      <div className="space-y-1">
                        <span className="text-xs font-semibold text-gray-700">
                          タイトル（表・Gemini表示用）
                        </span>
                        <div className="rounded-lg border px-3 py-2 bg-white text-xs">
                          {set.title ? (
                            <MathMarkdown text={set.title} />
                          ) : (
                            <span className="text-gray-400 italic">
                              （タイトルが未入力です）
                            </span>
                          )}
                        </div>
                      </div>

                      {/* タイトル：裏（入力欄） */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-700">
                            タイトルの入力欄（裏）
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleInputReveal(set.id)}
                            className="text-[11px] rounded-lg border px-2 py-1 hover:bg-gray-50"
                          >
                            {rTitle.input
                              ? "裏を閉じる（入力欄を隠す）"
                              : "裏を開く（入力欄を表示）"}
                          </button>
                        </div>
                        {rTitle.input ? (
                          <textarea
                            value={set.title}
                            onChange={(e) =>
                              updateTitle(currentFile.id, set.id, e.target.value)
                            }
                            rows={2}
                            className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
                            placeholder="例：$$e^{ix} = \cos x + i\sin x$$ の意味 / 応用 など（Geminiにコピペするテキスト）"
                          />
                        ) : (
                          <div className="w-full rounded-lg border px-3 py-3 text-[11px] text-gray-400 text-center italic bg-gray-50">
                            （タイトルの入力欄は裏側にあります。「裏を開く」ボタンで編集）
                          </div>
                        )}
                      </div>

                      {/* 数式カード群（従来どおり） */}
                      <div className="space-y-3">
                        {set.formulas.map((fm, j) => {
                          const r = getReveal(fm.id);
                          return (
                            <div
                              key={fm.id}
                              className="rounded-xl border bg-white px-3 py-3 space-y-3"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-semibold text-gray-700">
                                  数式カード {idx + 1}-{j + 1}
                                </span>
                                <button
                                  onClick={() => deleteFormula(set.id, fm.id)}
                                  className="text-[11px] text-red-500 hover:underline"
                                >
                                  このカードを削除
                                </button>
                              </div>

                              {/* 入力欄（裏向き） */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-semibold text-gray-700">
                                    数式の入力欄（裏向き）
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => toggleInputReveal(fm.id)}
                                    className="text-[11px] rounded-lg border px-2 py-1 hover:bg-gray-50"
                                  >
                                    {r.input
                                      ? "裏返す（隠す）"
                                      : "めくる（入力を表示）"}
                                  </button>
                                </div>
                                {r.input ? (
                                  <textarea
                                    value={fm.source}
                                    onChange={(e) =>
                                      updateFormula(
                                        currentFile.id,
                                        set.id,
                                        fm.id,
                                        e.target.value
                                      )
                                    }
                                    rows={3}
                                    className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
                                    placeholder="例：$$e^{ix} = \cos x + i\sin x$$"
                                  />
                                ) : (
                                  <div className="w-full rounded-lg border px-3 py-3 text-[11px] text-gray-400 text-center italic bg-gray-50">
                                    （入力欄は裏向きです。「めくる」ボタンで編集内容を表示）
                                  </div>
                                )}
                              </div>

                              {/* 表示欄（裏向き） */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-semibold text-gray-700">
                                    数式の表示欄（裏向き）
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => toggleDisplayReveal(fm.id)}
                                    className="text-[11px] rounded-lg border px-2 py-1 hover:bg-gray-50"
                                  >
                                    {r.display
                                      ? "裏返す（隠す）"
                                      : "めくる（表示を確認）"}
                                  </button>
                                </div>
                                {r.display ? (
                                  <div className="rounded-lg border px-3 py-2 bg-gray-50">
                                    <MathMarkdown text={fm.source} />
                                  </div>
                                ) : (
                                  <div className="w-full rounded-lg border px-3 py-3 text-[11px] text-gray-400 text-center italic bg-gray-50">
                                    （表示欄は裏向きです。「めくる」ボタンで数式を確認）
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {/* このタイトルに数式カードを追加 */}
                        <button
                          type="button"
                          onClick={() => addFormula(set.id)}
                          className="mt-1 rounded-xl border px-3 py-1.5 text-[11px] hover:bg-gray-50"
                        >
                          数式カードを追加
                        </button>
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
