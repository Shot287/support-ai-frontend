// src/features/study/DevPlan.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type ID = string;

type SubNote = { id: ID; title: string; content: string };
type Note = { id: ID; title: string; subnotes: SubNote[] };
type Folder = { id: ID; title: string };
type Store = {
  folders: Folder[];
  notesByFolder: Record<ID, Note[]>;
  currentFolderId?: ID;
  version: 1;
};

const KEY = "devplan_v1";

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function load(): Store {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) {
      const baseFolders: Folder[] = [
        { id: uid(), title: "先延ばし対策" },
        { id: uid(), title: "睡眠管理" },
        { id: uid(), title: "勉強" },
        { id: uid(), title: "Mental" },
      ];
      const firstId = baseFolders[0]?.id;
      return {
        folders: baseFolders,
        notesByFolder: Object.fromEntries(baseFolders.map(f => [f.id, [] as Note[]])),
        currentFolderId: firstId,
        version: 1,
      };
    }
    const parsed = JSON.parse(raw) as Store;
    // ゆるい正規化
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      notesByFolder: typeof parsed.notesByFolder === "object" && parsed.notesByFolder ? parsed.notesByFolder : {},
      currentFolderId: parsed.currentFolderId,
      version: 1,
    };
  } catch {
    return { folders: [], notesByFolder: {}, version: 1 };
  }
}

function save(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function DevPlan() {
  const [store, setStore] = useState<Store>(() => load());
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; save(store); }, [store]);

  const folders = store.folders;
  const currentFolderId = store.currentFolderId ?? folders[0]?.id;
  const currentFolder = folders.find(f => f.id === currentFolderId);
  const notes = useMemo<Note[]>(
    () => (currentFolderId ? (store.notesByFolder[currentFolderId] || []) : []),
    [store.notesByFolder, currentFolderId]
  );

  /* ===== フォルダー操作 ===== */
  const addFolder = () => {
    const title = prompt("新しいフォルダー名", "新しいフォルダー");
    if (!title) return;
    const id = uid();
    setStore(s => ({
      ...s,
      folders: [...s.folders, { id, title }],
      notesByFolder: { ...s.notesByFolder, [id]: [] },
      currentFolderId: id,
    }));
  };

  const renameFolder = (id: ID) => {
    const f = storeRef.current.folders.find(x => x.id === id);
    if (!f) return;
    const title = prompt("フォルダー名を変更", f.title);
    if (!title) return;
    setStore(s => ({ ...s, folders: s.folders.map(x => (x.id === id ? { ...x, title } : x)) }));
  };

  const deleteFolder = (id: ID) => {
    if (!confirm("このフォルダーを削除しますか？（配下のノートも削除）")) return;
    setStore(s => {
      const remain = s.folders.filter(x => x.id !== id);
      const { [id]: _, ...notesByFolder } = s.notesByFolder;
      const nextCurrent = s.currentFolderId === id ? remain[0]?.id : s.currentFolderId;
      return { ...s, folders: remain, notesByFolder, currentFolderId: nextCurrent };
    });
  };

  const switchFolder = (id: ID) => setStore(s => ({ ...s, currentFolderId: id }));

  /* ===== ノート操作（一覧側） ===== */
  const addNote = (folderId: ID) => {
    const title = prompt("ノートのタイトル（機能名など）", "新しいノート");
    if (!title) return;
    const note: Note = {
      id: uid(),
      title,
      // 詳細ページ（開いた状態）で見せるため、初期で2枚用意
      subnotes: [
        { id: uid(), title: "課題点", content: "" },
        { id: uid(), title: "計画", content: "" },
      ],
    };
    setStore(s => ({
      ...s,
      notesByFolder: {
        ...s.notesByFolder,
        [folderId]: [...(s.notesByFolder[folderId] || []), note],
      },
    }));
  };

  const renameNote = (folderId: ID, noteId: ID) => {
    const n = (storeRef.current.notesByFolder[folderId] || []).find(x => x.id === noteId);
    if (!n) return;
    const title = prompt("ノートのタイトルを変更", n.title);
    if (!title) return;
    setStore(s => ({
      ...s,
      notesByFolder: {
        ...s.notesByFolder,
        [folderId]: (s.notesByFolder[folderId] || []).map(x => x.id === noteId ? { ...x, title } : x),
      },
    }));
  };

  const deleteNote = (folderId: ID, noteId: ID) => {
    if (!confirm("このノートを削除しますか？（配下の小ノートも削除）")) return;
    setStore(s => ({
      ...s,
      notesByFolder: {
        ...s.notesByFolder,
        [folderId]: (s.notesByFolder[folderId] || []).filter(x => x.id !== noteId),
      },
    }));
  };

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      {/* 左：フォルダー一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">フォルダー</h2>
          <button onClick={addFolder} className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50">追加</button>
        </div>
        {folders.length === 0 ? (
          <p className="text-sm text-gray-500">フォルダーがありません。</p>
        ) : (
          <ul className="space-y-1">
            {folders.map((f) => (
              <li key={f.id}>
                <div className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 ${currentFolderId === f.id ? "bg-gray-50 border" : ""}`}>
                  <button onClick={() => switchFolder(f.id)} className="text-left min-w-0 truncate" title={f.title}>
                    {f.title}
                  </button>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => renameFolder(f.id)} className="rounded-lg border px-2 py-1 text-xs">名</button>
                    <button onClick={() => deleteFolder(f.id)} className="rounded-lg border px-2 py-1 text-xs">削</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 右：ノート（親は閉じた表示。タイトルで詳細へ） */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">{currentFolder ? `「${currentFolder.title}」のノート` : "ノート"}</h2>
          {currentFolderId && (
            <button onClick={() => addNote(currentFolderId)} className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50">
              ノート追加
            </button>
          )}
        </div>

        {(!currentFolderId || notes.length === 0) ? (
          <p className="text-sm text-gray-500">{currentFolderId ? "ノートがありません。「ノート追加」で作成してください。" : "フォルダーを選択してください。"}</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  {/* タイトルクリックで詳細ページへ遷移 */}
                  <Link
                    href={`/study/dev-plan/${currentFolderId}/${n.id}`}
                    className="font-semibold underline-offset-2 hover:underline break-words"
                  >
                    {n.title}
                  </Link>
                  <div className="flex gap-2">
                    <button onClick={() => renameNote(currentFolderId!, n.id)} className="rounded-lg border px-2 py-1 text-xs">名</button>
                    <button onClick={() => deleteNote(currentFolderId!, n.id)} className="rounded-lg border px-2 py-1 text-xs">削</button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-500">※ クリックで詳細ページへ。小ノートは詳細で常時展開されます。</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
