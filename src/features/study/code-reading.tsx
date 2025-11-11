// src/features/study/code-reading.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { cpp } from "@codemirror/lang-cpp";
import type { Extension } from "@codemirror/state";

type ID = string;

type NodeKind = "folder" | "file";

type Node = {
  id: ID;
  name: string;
  parentId: ID | null;
  kind: NodeKind;
};

type CodeLanguage = "python" | "typescript" | "cpp" | "text";

type ReadingSet = {
  id: ID;
  code: string;
  myNote: string;
  aiNote: string;
};

type FileData = {
  id: ID;
  sets: ReadingSet[];
  // 各ファイルごとのコード言語
  language?: CodeLanguage;
};

type Store = {
  nodes: Record<ID, Node>;
  files: Record<ID, FileData>;
  currentFolderId: ID | null;
  currentFileId: ID | null;
  version: 1;
};

const LOCAL_KEY = "code_reading_v1";
const DOC_KEY = "code_reading_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

// 初期状態：ルート直下に Python / TypeScript / C++ フォルダを用意
function createDefaultStore(): Store {
  const pythonId = uid();
  const tsId = uid();
  const cppId = uid();

  const nodes: Record<ID, Node> = {
    [pythonId]: {
      id: pythonId,
      name: "Python",
      parentId: null,
      kind: "folder",
    },
    [tsId]: {
      id: tsId,
      name: "TypeScript",
      parentId: null,
      kind: "folder",
    },
    [cppId]: {
      id: cppId,
      name: "C++",
      parentId: null,
      kind: "folder",
    },
  };

  return {
    nodes,
    files: {},
    currentFolderId: pythonId,
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
  } catch {
    // 失敗しても無視
  }
}

// 言語ごとの CodeMirror 拡張
function getExtensionsForLanguage(lang: CodeLanguage | undefined): Extension[] {
  if (lang === "python") return [python()];
  if (lang === "typescript") return [javascript({ typescript: true })];
  if (lang === "cpp") return [cpp()];
  return [];
}

export default function CodeReading() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // 左側：新規フォルダ / ファイル名入力
  const [newFolderName, setNewFolderName] = useState("");
  const [newFileName, setNewFileName] = useState("");

  // 右側：めくり状態（自分の解釈 / AIの添削）
  const [revealState, setRevealState] = useState<
    Record<ID, { showMy: boolean; showAi: boolean }>
  >({});

  const currentFolderId = store.currentFolderId;
  const currentFileId = store.currentFileId;

  // 同期：store が変わるたびに localStorage + user_docs に保存
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
    (async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, store);
      } catch {
        // サーバ不調時は無視（ローカルのみで動作）
      }
    })();
  }, [store]);

  // 初回マウント時：サーバの最新版を取得
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
      } catch {
        // オフラインでも動作させる
      }
    })();
  }, []);

  const nodes = store.nodes;

  const currentFolder = currentFolderId ? nodes[currentFolderId] ?? null : null;

  // カレントフォルダの中身取得（フォルダ → ファイル の順で並べる）
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

  // パンくず（ルート → 現在）
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
      const firstSet: ReadingSet = {
        id: uid(),
        code: "",
        myNote: "",
        aiNote: "",
      };
      const fileData: FileData = {
        id,
        sets: [firstSet],
        language: "python", // デフォルトはPython
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

  // フォルダ削除：中のサブフォルダとファイルもすべて削除
  const deleteFolder = (id: ID) => {
    if (!confirm("このフォルダと中身をすべて削除します。よろしいですか?")) return;

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
        if (!toDelete.has(nid)) {
          nextNodes[nid] = node;
        }
      }
      for (const [fid, file] of Object.entries(s.files)) {
        if (!toDelete.has(fid)) {
          nextFiles[fid] = file;
        }
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
    if (!confirm("このファイルを削除します。よろしいですか?")) return;
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

  const addSetToCurrentFile = () => {
    if (!currentFileId) return;
    setStore((s) => {
      const file = s.files[currentFileId];
      if (!file) return s;
      const newSet: ReadingSet = {
        id: uid(),
        code: "",
        myNote: "",
        aiNote: "",
      };
      return {
        ...s,
        files: {
          ...s.files,
          [currentFileId]: {
            ...file,
            sets: [...file.sets, newSet],
          },
        },
      };
    });
  };

  const updateSetField = (
    fileId: ID,
    setId: ID,
    field: "code" | "myNote" | "aiNote",
    value: string
  ) => {
    setStore((s) => {
      const file = s.files[fileId];
      if (!file) return s;
      const sets = file.sets.map((st) =>
        st.id === setId ? { ...st, [field]: value } : st
      );
      return {
        ...s,
        files: {
          ...s.files,
          [fileId]: { ...file, sets },
        },
      };
    });
  };

  const toggleReveal = (setId: ID, target: "my" | "ai") => {
    setRevealState((prev) => {
      const cur = prev[setId] ?? { showMy: false, showAi: false };
      return {
        ...prev,
        [setId]:
          target === "my"
            ? { ...cur, showMy: !cur.showMy }
            : { ...cur, showAi: !cur.showAi },
      };
    });
  };

  const setFileLanguage = (fileId: ID, lang: CodeLanguage) => {
    setStore((s) => {
      const file = s.files[fileId];
      if (!file) return s;
      return {
        ...s,
        files: {
          ...s.files,
          [fileId]: {
            ...file,
            language: lang,
          },
        },
      };
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* 左：フォルダ＆ファイルツリー */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">コードリーディング</h2>

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
                        ? "bg-black text-white"
                        : "bg-white hover:bg-gray-50")
                    }
                  >
                    <span className="mr-2 text-xs text-gray-400">
                      {n.kind === "folder" ? "📁" : "📄"}
                    </span>
                    {n.name}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      n.kind === "folder" ? deleteFolder(n.id) : deleteFile(n.id)
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

        <div className="border-t pt-3 mt-3 space-y-3">
          <div>
            <h3 className="text-xs font-semibold mb-1">フォルダを追加</h3>
            <div className="flex gap-2">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="flex-1 rounded-xl border px-3 py-2 text-xs"
                placeholder="例: 章1 / AtCoder / Tutorial など"
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
                placeholder="例: 二分探索のコード / DP練習1 など"
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

      {/* 右：ファイル内容（コード / 自分の解釈 / AI 添削） */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[260px]">
        {!currentFile || !nodes[currentFile.id] ? (
          <div className="text-sm text-gray-500">
            左のフォルダからファイルを選ぶか、新しいファイルを作成してください。
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h2 className="font-semibold text-base">
                ファイル: {nodes[currentFile.id]?.name ?? ""}
              </h2>
              {/* 言語選択 */}
              <div className="ml-auto flex items-center gap-2 text-xs">
                <span className="text-gray-600">言語:</span>
                <select
                  value={currentFile.language ?? "python"}
                  onChange={(e) =>
                    setFileLanguage(
                      currentFile.id,
                      e.target.value as CodeLanguage
                    )
                  }
                  className="rounded-lg border px-2 py-1 text-xs"
                >
                  <option value="python">Python</option>
                  <option value="typescript">TypeScript</option>
                  <option value="cpp">C++</option>
                  <option value="text">テキスト</option>
                </select>
              </div>
              <button
                type="button"
                onClick={addSetToCurrentFile}
                className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
              >
                セットを追加
              </button>
            </div>

            {currentFile.sets.length === 0 ? (
              <p className="text-sm text-gray-500">
                セットがありません。「セットを追加」で新しい学習セットを作成できます。
              </p>
            ) : (
              <div className="space-y-4">
                {currentFile.sets.map((s, idx) => {
                  const r = revealState[s.id] ?? {
                    showMy: false,
                    showAi: false,
                  };
                  const lang = currentFile.language ?? "python";
                  return (
                    <div
                      key={s.id}
                      className="rounded-2xl border px-4 py-3 bg-gray-50 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">
                          セット {idx + 1}
                        </h3>
                      </div>

                      {/* コード板（CodeMirror） */}
                      <div>
                        <div className="text-xs font-semibold mb-1 text-gray-700">
                          コード
                        </div>
                        <div className="rounded-xl border overflow-hidden bg-black">
                          <CodeMirror
                            value={s.code}
                            height="220px"
                            theme={vscodeDark}
                            extensions={getExtensionsForLanguage(lang)}
                            onChange={(value) =>
                              updateSetField(
                                currentFile.id,
                                s.id,
                                "code",
                                value
                              )
                            }
                            basicSetup={{
                              lineNumbers: true,
                              highlightActiveLine: true,
                              foldGutter: true,
                            }}
                          />
                        </div>
                      </div>

                      {/* 自分の解釈（裏向き → めくる） */}
                      <div className="rounded-xl border bg-white px-3 py-2">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-xs font-semibold text-gray-700">
                            自分の解釈
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleReveal(s.id, "my")}
                            className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                          >
                            {r.showMy ? "隠す" : "めくる"}
                          </button>
                        </div>
                        {r.showMy ? (
                          <textarea
                            value={s.myNote}
                            onChange={(e) =>
                              updateSetField(
                                currentFile.id,
                                s.id,
                                "myNote",
                                e.target.value
                              )
                            }
                            rows={4}
                            className="w-full rounded-lg border px-3 py-2 text-xs leading-relaxed"
                            placeholder="このコードは何をしているか、自分の言葉で説明してみてください。"
                          />
                        ) : (
                          <div className="text-xs text-gray-400 italic py-2">
                            裏向きの状態です。内容を思い出したいときは「めくる」を押してください。
                          </div>
                        )}
                      </div>

                      {/* AI の添削（裏向き → めくる） */}
                      <div className="rounded-xl border bg-white px-3 py-2">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-xs font-semibold text-gray-700">
                            AIの添削・コメント
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleReveal(s.id, "ai")}
                            className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                          >
                            {r.showAi ? "隠す" : "めくる"}
                          </button>
                        </div>
                        {r.showAi ? (
                          <textarea
                            value={s.aiNote}
                            onChange={(e) =>
                              updateSetField(
                                currentFile.id,
                                s.id,
                                "aiNote",
                                e.target.value
                              )
                            }
                            rows={4}
                            className="w-full rounded-lg border px-3 py-2 text-xs leading-relaxed"
                            placeholder="AIのフィードバックや、後から見返したいポイントを書き込んでください。"
                          />
                        ) : (
                          <div className="text-xs text-gray-400 italic py-2">
                            裏向きの状態です。自分の解釈を思い出したあとに、答え合わせとして見てください。
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
