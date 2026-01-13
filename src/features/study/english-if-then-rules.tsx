// src/features/study/english-if-then-rules.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";

type ID = string;

type NodeKind = "folder" | "file";

type Node = {
  id: ID;
  name: string;
  parentId: ID | null;
  kind: NodeKind;
};

type Card = {
  id: ID;
  ifText: string; // 英文
  thenText: string; // 和訳（正解）
  thenMemo?: string; // ★ 追加：和訳のメモ
  marked?: boolean; // ★（未保存データは false 扱い）
};

type DeckFile = {
  id: ID;
  cards: Card[];
};

type Store = {
  nodes: Record<ID, Node>;
  files: Record<ID, DeckFile>;
  currentFolderId: ID | null;
  currentFileId: ID | null;
  version: 1;
};

const LOCAL_KEY = "study_if_then_rules_v1";
const DOC_KEY = "study_if_then_rules_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ----------------- Local Store -----------------
function createDefaultStore(): Store {
  const rootId = uid();
  const rootNode: Node = {
    id: rootId,
    name: "If-Then",
    parentId: null,
    kind: "folder",
  };

  return {
    nodes: { [rootId]: rootNode },
    files: {},
    currentFolderId: rootId,
    currentFileId: null,
    version: 1,
  };
}

function normalizeStore(s: Store): Store {
  // 旧データ互換：marked / thenMemo が無いカードは補完
  const nextFiles: Record<ID, DeckFile> = {};
  for (const [fid, f] of Object.entries(s.files ?? {})) {
    const cards = (f.cards ?? []).map((c) => ({
      ...c,
      marked: Boolean((c as any).marked),
      thenMemo: typeof (c as any).thenMemo === "string" ? (c as any).thenMemo : "",
    }));
    nextFiles[fid] = { ...f, id: (f as any).id ?? fid, cards };
  }
  return { ...s, files: nextFiles, version: 1 };
}

function loadLocal(): Store {
  try {
    if (typeof window === "undefined") return createDefaultStore();
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createDefaultStore();
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (!parsed || typeof parsed !== "object") return createDefaultStore();

    const def = createDefaultStore();
    const s: Store = {
      nodes: (parsed.nodes as any) ?? def.nodes,
      files: (parsed.files as any) ?? {},
      currentFolderId: (parsed.currentFolderId as any) ?? def.currentFolderId,
      currentFileId: (parsed.currentFileId as any) ?? null,
      version: 1,
    };
    return normalizeStore(s);
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
    // ignore
  }
}

// ----------------- JSON Deck I/O -----------------
type DeckJsonV1 = {
  kind: "if_then_deck";
  version: 1;
  name: string;
  cards: Array<{
    ifText: string;
    thenText: string;
    thenMemo?: string; // ★ 追加
    marked?: boolean; // ★（あってもなくてもOK）
  }>;
};

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validateDeckJsonV1(obj: any): obj is DeckJsonV1 {
  if (!obj || typeof obj !== "object") return false;
  if (obj.kind !== "if_then_deck") return false;
  if (obj.version !== 1) return false;
  if (typeof obj.name !== "string") return false;
  if (!Array.isArray(obj.cards)) return false;
  for (const c of obj.cards) {
    if (!c || typeof c !== "object") return false;
    if (typeof c.ifText !== "string") return false;
    if (typeof c.thenText !== "string") return false;
    if (c.thenMemo !== undefined && typeof c.thenMemo !== "string") return false;
    if (c.marked !== undefined && typeof c.marked !== "boolean") return false;
  }
  return true;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function readFileAsText(file: File): Promise<string> {
  return await file.text();
}

// ----------------- Study Session (UI state only) -----------------
type StudyMode = "edit" | "study";

type StudyOrder = {
  cardIds: ID[];
  idx: number;
};

type Judge = "correct" | "incorrect";

type PerCardState = {
  revealed: boolean; // Then表示済みか
  judge: Judge | null; // 正解/不正解（未回答はnull）
};

type PasteAction = "new" | "replace" | "append";

export default function EnglishIfThenRules() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // mode
  const [mode, setMode] = useState<StudyMode>("edit");

  // per-card UI states in study
  const [studyOrder, setStudyOrder] = useState<StudyOrder | null>(null);
  const [studyMap, setStudyMap] = useState<Record<ID, PerCardState>>({});
  const [studyShuffle, setStudyShuffle] = useState(true);

  // ★ 追加：マークされたカードだけで学習
  const [studyMarkedOnly, setStudyMarkedOnly] = useState(false);

  // 左：作成
  const [newFolderName, setNewFolderName] = useState("");
  const [newFileName, setNewFileName] = useState("");

  // ★ 追加：JSONペースト import UI
  const [pasteJsonText, setPasteJsonText] = useState("");
  const [pasteAction, setPasteAction] = useState<PasteAction>("new");

  const nodes = store.nodes;
  const currentFolderId = store.currentFolderId;
  const currentFileId = store.currentFileId;

  const currentFile = currentFileId ? store.files[currentFileId] ?? null : null;
  const currentFileName = currentFileId ? nodes[currentFileId]?.name ?? "" : "";

  // Store change => localStorage only
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // manual sync
  useEffect(() => {
    const unsubscribe = registerManualSync({
      pull: async () => {
        try {
          const remote = await loadUserDoc<Store>(DOC_KEY);
          if (remote && remote.version === 1) {
            const normalized = normalizeStore(remote);
            setStore(normalized);
            saveLocal(normalized);
          }
        } catch (e) {
          console.warn("[if-then] manual PULL failed:", e);
        }
      },
      push: async () => {
        try {
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        } catch (e) {
          console.warn("[if-then] manual PUSH failed:", e);
        }
      },
      reset: async () => {
        /* no-op */
      },
    });
    return unsubscribe;
  }, []);

  // children
  const children = useMemo(() => {
    const list = Object.values(nodes).filter((n) => n.parentId === currentFolderId);
    return list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });
  }, [nodes, currentFolderId]);

  // breadcrumb
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

  // ----------------- Tree ops -----------------
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
      const fileData: DeckFile = { id, cards: [] };
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
        s.currentFileId && s.nodes[s.currentFileId]?.parentId === id ? s.currentFileId : null,
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
      const nextFiles: Record<ID, DeckFile> = {};

      for (const [nid, node] of Object.entries(s.nodes)) {
        if (!toDelete.has(nid)) nextNodes[nid] = node;
      }
      for (const [fid, file] of Object.entries(s.files)) {
        if (!toDelete.has(fid)) nextFiles[fid] = file;
      }

      const currentFolderIdNew = toDelete.has(s.currentFolderId ?? "") ? null : s.currentFolderId;
      const currentFileIdNew = toDelete.has(s.currentFileId ?? "") ? null : s.currentFileId;

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
    if (!confirm("このファイル（デッキ）を削除します。よろしいですか？")) return;
    setStore((s) => {
      const nextNodes = { ...s.nodes };
      const nextFiles = { ...s.files };
      delete nextNodes[id];
      delete nextFiles[id];
      const currentFileIdNew = s.currentFileId === id ? null : s.currentFileId;
      return { ...s, nodes: nextNodes, files: nextFiles, currentFileId: currentFileIdNew };
    });
  };

  // ----------------- Deck (cards) ops -----------------
  const addCard = () => {
    if (!currentFile) return;
    const card: Card = { id: uid(), ifText: "", thenText: "", thenMemo: "", marked: false };
    setStore((s) => ({
      ...s,
      files: {
        ...s.files,
        [currentFile.id]: {
          ...s.files[currentFile.id],
          cards: [...(s.files[currentFile.id]?.cards ?? []), card],
        },
      },
    }));
  };

  const updateCard = (cardId: ID, updater: (prev: Card) => Card) => {
    if (!currentFile) return;
    setStore((s) => {
      const file = s.files[currentFile.id];
      if (!file) return s;
      const cards = file.cards.map((c) => (c.id === cardId ? updater(c) : c));
      return { ...s, files: { ...s.files, [currentFile.id]: { ...file, cards } } };
    });
  };

  // ★ StudyView から直接編集できるようにするための薄いラッパ
  const editCardFields = (
    cardId: ID,
    patch: Partial<Pick<Card, "ifText" | "thenText" | "thenMemo">>
  ) => {
    updateCard(cardId, (prev) => ({
      ...prev,
      ifText: patch.ifText !== undefined ? patch.ifText : prev.ifText,
      thenText: patch.thenText !== undefined ? patch.thenText : prev.thenText,
      thenMemo: patch.thenMemo !== undefined ? patch.thenMemo : (prev.thenMemo ?? ""),
    }));
  };

  const toggleMarkCard = (cardId: ID) => {
    if (!currentFile) return;
    updateCard(cardId, (prev) => ({ ...prev, marked: !Boolean(prev.marked) }));
  };

  const deleteCard = (cardId: ID) => {
    if (!currentFile) return;
    if (!confirm("このカードを削除しますか？")) return;
    setStore((s) => {
      const file = s.files[currentFile.id];
      if (!file) return s;
      return {
        ...s,
        files: {
          ...s.files,
          [currentFile.id]: { ...file, cards: file.cards.filter((c) => c.id !== cardId) },
        },
      };
    });
    setStudyMap((prev) => {
      const cp = { ...prev };
      delete cp[cardId];
      return cp;
    });
  };

  const moveCard = (cardId: ID, dir: -1 | 1) => {
    if (!currentFile) return;
    setStore((s) => {
      const file = s.files[currentFile.id];
      if (!file) return s;
      const idx = file.cards.findIndex((c) => c.id === cardId);
      if (idx < 0) return s;
      const j = idx + dir;
      if (j < 0 || j >= file.cards.length) return s;
      const next = [...file.cards];
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return { ...s, files: { ...s.files, [currentFile.id]: { ...file, cards: next } } };
    });
  };

  // ----------------- Study controls -----------------
  const startStudy = () => {
    if (!currentFile) return;

    const cards = currentFile.cards.map((c) => ({
      ...c,
      marked: Boolean(c.marked),
      thenMemo: typeof c.thenMemo === "string" ? c.thenMemo : "",
    }));
    const filtered = studyMarkedOnly ? cards.filter((c) => c.marked) : cards;

    if (filtered.length === 0) {
      alert(
        studyMarkedOnly
          ? "マークされたカードがありません。先にカードをマークしてください。"
          : "このデッキにはカードがありません。先にカードを追加してください。"
      );
      return;
    }

    const ids = filtered.map((c) => c.id);
    const order = studyShuffle ? shuffle([...ids]) : ids;

    setStudyOrder({ cardIds: order, idx: 0 });

    const init: Record<ID, PerCardState> = {};
    for (const id of order) init[id] = { revealed: false, judge: null };
    setStudyMap(init);

    setMode("study");
  };

  const stopStudy = () => {
    setMode("edit");
    setStudyOrder(null);
    setStudyMap({});
  };

  const revealThen = (cardId: ID) => {
    setStudyMap((prev) => ({
      ...prev,
      [cardId]: { ...(prev[cardId] ?? { revealed: false, judge: null }), revealed: true },
    }));
  };

  const judgeCard = (cardId: ID, judge: Judge) => {
    setStudyMap((prev) => ({
      ...prev,
      [cardId]: { ...(prev[cardId] ?? { revealed: false, judge: null }), judge },
    }));
  };

  const nextCard = () => {
    setStudyOrder((o) => {
      if (!o) return o;
      const nx = Math.min(o.idx + 1, o.cardIds.length - 1);
      return { ...o, idx: nx };
    });
  };

  const prevCard = () => {
    setStudyOrder((o) => {
      if (!o) return o;
      const nx = Math.max(o.idx - 1, 0);
      return { ...o, idx: nx };
    });
  };

  const judgeAndNext = (cardId: ID, judge: Judge) => {
    judgeCard(cardId, judge);
    setStudyOrder((o) => {
      if (!o) return o;
      const atLast = o.idx >= o.cardIds.length - 1;
      if (atLast) return o;
      return { ...o, idx: o.idx + 1 };
    });
  };

  // ----------------- JSON Import helpers (text/file shared) -----------------
  const parseDeckJsonFromText = (text: string): DeckJsonV1 | null => {
    const obj = safeJsonParse(text);
    if (!validateDeckJsonV1(obj)) return null;
    return obj;
  };

  const applyDeckJsonAsNewDeck = (obj: DeckJsonV1) => {
    setStore((s) => {
      const id = uid();
      const node: Node = {
        id,
        name: obj.name?.trim() ? obj.name.trim() : "Imported Deck",
        parentId: s.currentFolderId,
        kind: "file",
      };
      const deck: DeckFile = {
        id,
        cards: obj.cards.map((c) => ({
          id: uid(),
          ifText: c.ifText ?? "",
          thenText: c.thenText ?? "",
          thenMemo: c.thenMemo ?? "",
          marked: Boolean(c.marked),
        })),
      };
      return {
        ...s,
        nodes: { ...s.nodes, [id]: node },
        files: { ...s.files, [id]: deck },
        currentFileId: id,
      };
    });
  };

  const applyDeckJsonReplaceCurrent = (obj: DeckJsonV1) => {
    if (!currentFileId) {
      alert("置き換えるファイル（デッキ）を選択してください。");
      return;
    }

    if (!confirm("現在選択中のデッキを、このJSONで置き換えます。よろしいですか？")) return;

    setStore((s) => {
      const fileId = currentFileId;
      const existing = s.files[fileId];
      if (!existing) return s;

      const nextNodes = {
        ...s.nodes,
        [fileId]: {
          ...s.nodes[fileId],
          name: obj.name?.trim() ? obj.name.trim() : s.nodes[fileId].name,
        },
      };

      const nextFile: DeckFile = {
        id: fileId,
        cards: obj.cards.map((c) => ({
          id: uid(),
          ifText: c.ifText ?? "",
          thenText: c.thenText ?? "",
          thenMemo: c.thenMemo ?? "",
          marked: Boolean(c.marked),
        })),
      };

      return {
        ...s,
        nodes: nextNodes,
        files: { ...s.files, [fileId]: nextFile },
      };
    });
  };

  const applyDeckJsonAppendToCurrent = (obj: DeckJsonV1) => {
    if (!currentFileId) {
      alert("追加インポートする先のデッキを選択してください。");
      return;
    }

    const addCount = obj.cards.length;
    if (!confirm(`選択中デッキに、JSONのカード ${addCount} 件を追加します。よろしいですか？`)) return;

    setStore((s) => {
      const fileId = currentFileId;
      const existing = s.files[fileId];
      if (!existing) return s;

      const appended: Card[] = obj.cards.map((c) => ({
        id: uid(),
        ifText: c.ifText ?? "",
        thenText: c.thenText ?? "",
        thenMemo: c.thenMemo ?? "",
        marked: Boolean(c.marked),
      }));

      const nextFile: DeckFile = {
        ...existing,
        cards: [...(existing.cards ?? []), ...appended],
      };

      return {
        ...s,
        files: { ...s.files, [fileId]: nextFile },
      };
    });
  };

  // ----------------- JSON Export / Import (file) -----------------
  const exportDeckJson = () => {
    if (!currentFileId) {
      alert("エクスポートするファイル（デッキ）を選択してください。");
      return;
    }
    const file = store.files[currentFileId];
    if (!file) return;

    const name = nodes[currentFileId]?.name ?? "deck";
    const payload: DeckJsonV1 = {
      kind: "if_then_deck",
      version: 1,
      name,
      cards: file.cards.map((c) => ({
        ifText: c.ifText ?? "",
        thenText: c.thenText ?? "",
        thenMemo: c.thenMemo ?? "",
        marked: Boolean(c.marked),
      })),
    };

    const safeName = name.replace(/[\\/:*?"<>|]+/g, "_");
    downloadText(`${safeName}.json`, JSON.stringify(payload, null, 2));
  };

  const importDeckJsonAsNewFile = async (file: File) => {
    const text = await readFileAsText(file);
    const obj = parseDeckJsonFromText(text);
    if (!obj) {
      alert("このJSONは対応フォーマットではありません（if_then_deck v1）。");
      return;
    }
    applyDeckJsonAsNewDeck(obj);
  };

  const replaceCurrentDeckByJsonFile = async (file: File) => {
    const text = await readFileAsText(file);
    const obj = parseDeckJsonFromText(text);
    if (!obj) {
      alert("このJSONは対応フォーマットではありません（if_then_deck v1）。");
      return;
    }
    applyDeckJsonReplaceCurrent(obj);
  };

  const appendCurrentDeckByJsonFile = async (file: File) => {
    const text = await readFileAsText(file);
    const obj = parseDeckJsonFromText(text);
    if (!obj) {
      alert("このJSONは対応フォーマットではありません（if_then_deck v1）。");
      return;
    }
    applyDeckJsonAppendToCurrent(obj);
  };

  // ----------------- JSON Import (paste) -----------------
  const runPasteImport = () => {
    const text = pasteJsonText.trim();
    if (!text) {
      alert("JSONをペーストしてください。");
      return;
    }
    const obj = parseDeckJsonFromText(text);
    if (!obj) {
      alert("このJSONは対応フォーマットではありません（if_then_deck v1）。");
      return;
    }

    if (pasteAction === "new") {
      applyDeckJsonAsNewDeck(obj);
      setPasteJsonText("");
      return;
    }
    if (pasteAction === "replace") {
      applyDeckJsonReplaceCurrent(obj);
      return;
    }
    if (pasteAction === "append") {
      applyDeckJsonAppendToCurrent(obj);
      return;
    }
  };

  // ----------------- Helpers -----------------
  function shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  // ----------------- Render -----------------
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* Left tree */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">英語 If-Then ルール</h2>
          <span className="text-[11px] text-gray-500">1ファイル=1デッキ</span>
        </div>

        <div className="mb-3 text-xs text-gray-600">
          <div className="mb-1 font-medium">現在のフォルダ</div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setStore((s) => ({ ...s, currentFolderId: null, currentFileId: null }))}
              className={
                "text-xs rounded-lg px-2 py-1 " +
                (currentFolderId === null ? "bg-black text-white" : "bg-gray-100 hover:bg-gray-200")
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
                    (currentFolderId === b.id ? "bg-black text-white" : "bg-gray-100 hover:bg-gray-200")
                  }
                >
                  {b.name}
                </button>
              </span>
            ))}
          </div>
        </div>

        {currentFolderId !== null && (
          <button type="button" onClick={goUpFolder} className="mb-3 text-xs text-gray-600 underline">
            上のフォルダに戻る
          </button>
        )}

        <div className="mb-3">
          {children.length === 0 ? (
            <p className="text-xs text-gray-500">このフォルダには、まだ何もありません。</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {children.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => (n.kind === "folder" ? openFolder(n.id) : openFile(n.id))}
                    className={
                      "flex-1 text-left rounded-xl px-3 py-1.5 border " +
                      (currentFileId === n.id ? "bg-blue-600 text-white" : "bg-white hover:bg-gray-50")
                    }
                  >
                    <span className="mr-2 text-xs text-gray-400">{n.kind === "folder" ? "📁" : "🃏"}</span>
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
                      onClick={() => (n.kind === "folder" ? deleteFolder(n.id) : deleteFile(n.id))}
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

        {/* Add folder/file */}
        <div className="border-t pt-3 mt-3 space-y-3">
          <div>
            <h3 className="text-xs font-semibold mb-1">フォルダを追加</h3>
            <div className="flex gap-2">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="flex-1 rounded-xl border px-3 py-2 text-xs"
                placeholder="例: 文法 / Part5 / 重要表現"
              />
              <button type="button" onClick={addFolder} className="rounded-xl bg-black px-3 py-2 text-xs text-white">
                追加
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold mb-1">デッキ（ファイル）を追加</h3>
            <div className="flex gap-2">
              <input
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="flex-1 rounded-xl border px-3 py-2 text-xs"
                placeholder="例: 重要If-Then 001 / 条件文まとめ"
              />
              <button type="button" onClick={addFile} className="rounded-xl bg-black px-3 py-2 text-xs text-white">
                追加
              </button>
            </div>
          </div>

          {/* JSON I/O */}
          <div className="border-t pt-3">
            <h3 className="text-xs font-semibold mb-2">JSON（デッキ）</h3>

            <div className="grid gap-2">
              <button
                type="button"
                onClick={exportDeckJson}
                className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50 text-left"
              >
                ⬇️ エクスポート（選択中デッキをJSON保存）
              </button>

              <label className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50 cursor-pointer">
                ⬆️ インポート（新しいデッキとして追加：ファイル）
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.currentTarget.value = "";
                    if (f) importDeckJsonAsNewFile(f);
                  }}
                />
              </label>

              <label className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50 cursor-pointer">
                ♻️ インポート（選択中デッキを置き換え：ファイル）
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.currentTarget.value = "";
                    if (f) replaceCurrentDeckByJsonFile(f);
                  }}
                />
              </label>

              <label className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50 cursor-pointer">
                ➕ 追加インポート（選択中デッキに追加：ファイル）
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.currentTarget.value = "";
                    if (f) appendCurrentDeckByJsonFile(f);
                  }}
                />
              </label>

              {/* JSON paste import */}
              <div className="mt-2 rounded-2xl border p-3 bg-white">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-xs font-semibold text-gray-700">JSONをペーストしてインポート</div>
                  <select
                    value={pasteAction}
                    onChange={(e) => setPasteAction(e.target.value as PasteAction)}
                    className="text-xs rounded-lg border px-2 py-1 bg-white"
                    title="インポート方法"
                  >
                    <option value="new">新しいデッキとして追加</option>
                    <option value="replace">選択中デッキを置き換え</option>
                    <option value="append">選択中デッキに追加</option>
                  </select>
                </div>

                <textarea
                  value={pasteJsonText}
                  onChange={(e) => setPasteJsonText(e.target.value)}
                  rows={6}
                  className="w-full rounded-xl border px-3 py-2 text-[11px] font-mono"
                  placeholder={`ここに if_then_deck v1 のJSONをペースト\n例: {"kind":"if_then_deck","version":1,"name":"...","cards":[{"ifText":"...","thenText":"...","thenMemo":"..."}]}`}
                />

                <div className="flex items-center gap-2 mt-2">
                  <button type="button" onClick={runPasteImport} className="rounded-xl bg-black px-3 py-2 text-xs text-white">
                    実行
                  </button>
                  <button
                    type="button"
                    onClick={() => setPasteJsonText("")}
                    className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
                  >
                    クリア
                  </button>
                </div>

                <p className="text-[11px] text-gray-500 leading-relaxed mt-2">
                  フォーマット：kind=if_then_deck, version=1, name, cards[{`{ifText, thenText, thenMemo?, marked?}`}]。
                </p>

                {(pasteAction === "replace" || pasteAction === "append") && !currentFileId && (
                  <p className="text-[11px] text-red-600 mt-1">※「置き換え / 追加」は、左でデッキを選択してから実行してください。</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Right */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[200px]">
        {!currentFile ? (
          <p className="text-sm text-gray-500">
            左のフォルダからデッキ（ファイル）を選択するか、新しいデッキを作成してください。
          </p>
        ) : mode === "study" && studyOrder ? (
          <StudyView
            file={currentFile}
            fileName={currentFileName}
            order={studyOrder}
            map={studyMap}
            revealThen={revealThen}
            prevCard={prevCard}
            nextCard={nextCard}
            judgeAndNext={judgeAndNext}
            stopStudy={stopStudy}
            toggleMark={(cardId) => toggleMarkCard(cardId)}
            editCard={editCardFields}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="font-semibold">デッキ：「{currentFileName || "（名称未設定）"}」</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  If=英文 / Then=和訳（学習モードは「解答をチェック」でThenを表示 → 正解/不正解で記録）
                </p>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={studyMarkedOnly} onChange={(e) => setStudyMarkedOnly(e.target.checked)} />
                  マークのみで学習
                </label>

                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={studyShuffle} onChange={(e) => setStudyShuffle(e.target.checked)} />
                  シャッフル
                </label>

                <button type="button" onClick={startStudy} className="rounded-xl bg-black px-3 py-2 text-sm text-white">
                  ▶ 学習モード開始
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={addCard} className="rounded-xl bg-black px-3 py-2 text-sm text-white">
                ＋ カード追加
              </button>
              <p className="text-xs text-gray-500">
                カード数：{currentFile.cards.length} / マーク：{currentFile.cards.filter((c) => Boolean(c.marked)).length}
              </p>
            </div>

            {currentFile.cards.length === 0 ? (
              <p className="text-sm text-gray-500">まだカードがありません。「＋ カード追加」から If / Then を入力してください。</p>
            ) : (
              <div className="space-y-4">
                {currentFile.cards.map((card, idx) => {
                  const marked = Boolean(card.marked);
                  return (
                    <div key={card.id} className="rounded-2xl border px-4 py-3 bg-white space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <span>カード {idx + 1}</span>
                          <button
                            type="button"
                            onClick={() => toggleMarkCard(card.id)}
                            className={"text-xs rounded-lg border px-2 py-1 " + (marked ? "bg-yellow-100" : "hover:bg-gray-50")}
                            title="マーク"
                          >
                            {marked ? "★ マーク中" : "☆ マーク"}
                          </button>
                        </h3>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => moveCard(card.id, -1)}
                            className="text-xs rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                            title="上へ"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveCard(card.id, 1)}
                            className="text-xs rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                            title="下へ"
                          >
                            ↓
                          </button>
                          <button type="button" onClick={() => deleteCard(card.id)} className="text-xs text-red-500 hover:underline">
                            削除
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-xs font-semibold text-gray-700 mb-1">If（英文）</div>
                          <textarea
                            value={card.ifText}
                            onChange={(e) => updateCard(card.id, (prev) => ({ ...prev, ifText: e.target.value }))}
                            rows={4}
                            className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
                            placeholder="例: If you have any questions, please let me know."
                          />
                        </div>
                        <div className="space-y-3">
                          <div>
                            <div className="text-xs font-semibold text-gray-700 mb-1">Then（和訳）</div>
                            <textarea
                              value={card.thenText}
                              onChange={(e) => updateCard(card.id, (prev) => ({ ...prev, thenText: e.target.value }))}
                              rows={4}
                              className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
                              placeholder="例: もし何か質問があれば、教えてください。"
                            />
                          </div>

                          <div>
                            <div className="text-xs font-semibold text-gray-700 mb-1">Then（メモ）</div>
                            <textarea
                              value={card.thenMemo ?? ""}
                              onChange={(e) =>
                                updateCard(card.id, (prev) => ({ ...prev, thenMemo: e.target.value }))
                              }
                              rows={3}
                              className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
                              placeholder="例: 言い換え / 文法ポイント / ひっかかった点 など"
                            />
                          </div>
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

// ----------------- Study View Component -----------------
function StudyView(props: {
  file: DeckFile;
  fileName: string;
  order: { cardIds: ID[]; idx: number };
  map: Record<ID, { revealed: boolean; judge: Judge | null }>;
  revealThen: (cardId: ID) => void;
  prevCard: () => void;
  nextCard: () => void;
  judgeAndNext: (cardId: ID, judge: Judge) => void;
  stopStudy: () => void;
  toggleMark: (cardId: ID) => void;

  // ★ 学習モード中に If/Then/メモ を直接編集
  editCard: (cardId: ID, patch: Partial<{ ifText: string; thenText: string; thenMemo: string }>) => void;
}) {
  const { file, fileName, order, map, revealThen, prevCard, nextCard, judgeAndNext, stopStudy, toggleMark, editCard } = props;

  const total = order.cardIds.length;
  const cardId = order.cardIds[order.idx];
  const card = file.cards.find((c) => c.id === cardId);

  const state = map[cardId] ?? { revealed: false, judge: null };

  // 編集UI状態（このビュー内だけ）
  const [editIf, setEditIf] = useState(false);
  const [editThen, setEditThen] = useState(false);

  // ★追加：メモは常に入力できる（表示は Then の下に固定）
  // ※カード切替で編集トグルは閉じる
  useEffect(() => {
    setEditIf(false);
    setEditThen(false);
  }, [cardId]);

  // stats
  const judged = Object.values(map).filter((s) => s && s.judge !== null).length;
  const correct = Object.values(map).filter((s) => s && s.judge === "correct").length;
  const incorrect = Object.values(map).filter((s) => s && s.judge === "incorrect").length;
  const accuracy = judged === 0 ? 0 : Math.round((correct / judged) * 1000) / 10;

  if (!card) {
    return (
      <div>
        <p className="text-sm text-red-600">カードが見つかりませんでした。</p>
        <button className="mt-3 rounded-xl border px-3 py-2 text-sm" onClick={stopStudy}>
          戻る
        </button>
      </div>
    );
  }

  const atFirst = order.idx === 0;
  const atLast = order.idx === total - 1;
  const marked = Boolean(card.marked);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="font-semibold">学習モード：{fileName || "（名称未設定）"}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {order.idx + 1} / {total}　
            <span className="ml-2">
              正答率：{accuracy}%（正解 {correct} / 不正解 {incorrect} / 判定 {judged}）
            </span>
          </p>
        </div>
        <button type="button" onClick={stopStudy} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
          ✕ 終了
        </button>
      </div>

      <div className="rounded-2xl border px-4 py-4 bg-white space-y-4">
        {/* If */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-gray-700">If（英文）</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditIf((v) => !v)}
              className="text-xs rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
            >
              {editIf ? "編集を閉じる" : "編集"}
            </button>
            <button
              type="button"
              onClick={() => toggleMark(cardId)}
              className={"text-xs rounded-lg border px-2 py-1 " + (marked ? "bg-yellow-100" : "hover:bg-gray-50")}
              title="マーク"
            >
              {marked ? "★ マーク中" : "☆ マーク"}
            </button>
          </div>
        </div>

        {editIf ? (
          <textarea
            value={card.ifText ?? ""}
            onChange={(e) => editCard(cardId, { ifText: e.target.value })}
            rows={4}
            className="w-full rounded-xl border px-3 py-2 text-sm font-mono"
            placeholder="例: If you have any questions, please let me know."
          />
        ) : (
          <div className="rounded-xl border bg-gray-50 px-3 py-2 text-sm whitespace-pre-wrap">
            {card.ifText?.trim() ? card.ifText : <span className="text-gray-400">（英文が空です）</span>}
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => revealThen(cardId)} className="rounded-xl bg-black px-3 py-2 text-sm text-white">
            解答をチェック
          </button>

          <button
            type="button"
            onClick={() => judgeAndNext(cardId, "correct")}
            disabled={!state.revealed}
            className={"rounded-xl border px-3 py-2 text-sm " + (!state.revealed ? "text-gray-300" : "hover:bg-gray-50")}
          >
            正解
          </button>

          <button
            type="button"
            onClick={() => judgeAndNext(cardId, "incorrect")}
            disabled={!state.revealed}
            className={"rounded-xl border px-3 py-2 text-sm " + (!state.revealed ? "text-gray-300" : "hover:bg-gray-50")}
          >
            不正解
          </button>

          <button
            type="button"
            onClick={prevCard}
            disabled={atFirst}
            className={"rounded-xl border px-3 py-2 text-sm " + (atFirst ? "text-gray-300" : "hover:bg-gray-50")}
          >
            ← 前へ
          </button>

          <button
            type="button"
            onClick={nextCard}
            disabled={atLast}
            className={"rounded-xl border px-3 py-2 text-sm " + (atLast ? "text-gray-300" : "hover:bg-gray-50")}
          >
            次へ →
          </button>

          {state.judge && (
            <span className="text-xs text-gray-600 ml-1">判定：{state.judge === "correct" ? "正解" : "不正解"}</span>
          )}
        </div>

        {/* Then（正解の和訳） */}
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-gray-700">Then（正解の和訳）</div>
          <button
            type="button"
            onClick={() => setEditThen((v) => !v)}
            disabled={!state.revealed}
            className={
              "text-xs rounded-lg border px-2 py-1 " + (!state.revealed ? "text-gray-300" : "text-gray-600 hover:bg-gray-50")
            }
            title={!state.revealed ? "先に「解答をチェック」を押してください" : "和訳を編集"}
          >
            {editThen ? "編集を閉じる" : "編集"}
          </button>
        </div>

        {state.revealed ? (
          editThen ? (
            <textarea
              value={card.thenText ?? ""}
              onChange={(e) => editCard(cardId, { thenText: e.target.value })}
              rows={4}
              className="w-full rounded-xl border px-3 py-2 text-sm font-mono"
              placeholder="例: もし何か質問があれば、教えてください。"
            />
          ) : (
            <div className="rounded-xl border bg-gray-50 px-3 py-2 text-sm whitespace-pre-wrap">
              {card.thenText?.trim() ? card.thenText : <span className="text-gray-400">（和訳が空です）</span>}
            </div>
          )
        ) : (
          <div className="rounded-xl border bg-gray-50 px-3 py-2 text-sm whitespace-pre-wrap">
            <span className="text-gray-400">（「解答をチェック」を押すと表示されます）</span>
          </div>
        )}

        {/* ★追加：Then（メモ） */}
        <div>
          <div className="text-xs font-semibold text-gray-700 mb-1">Then（メモ）</div>
          <textarea
            value={card.thenMemo ?? ""}
            onChange={(e) => editCard(cardId, { thenMemo: e.target.value })}
            rows={3}
            className="w-full rounded-xl border px-3 py-2 text-sm font-mono"
            placeholder="例: 言い換え / 文法ポイント / ひっかかった点 など"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            ※メモは学習中いつでも入力できます（正解表示の有無とは独立）。
          </p>
        </div>
      </div>
    </>
  );
}
