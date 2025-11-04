// src/features/study/DevPlan.tsx
"use client";

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
    return parsed;
  } catch {
    return { folders: [], notesByFolder: {}, version: 1 };
  }
}

function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export function DevPlan() {
  const [store, setStore] = useState<Store>(() => load());
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; save(store); }, [store]);

  const folders = store.folders;
  const currentFolderId = store.currentFolderId ?? folders[0]?.id;
  const currentNotes = useMemo<Note[]>(
    () => (currentFolderId ? (store.notesByFolder[currentFolderId] || []) : []),
    [store.notesByFolder, currentFolderId]
  );
  const currentFolder = folders.find(f => f.id === currentFolderId);

  /* ===== フォルダー ===== */
  const addFolder = () => {
    const title = prompt("新しいフォルダー名", "新しいフォルダー");
    if (!title) return;
    const id = uid();
    const next: Store = {
      ...storeRef.current,
      folders: [...storeRef.current.folders, { id, title }],
      notesByFolder: { ...storeRef.current.notesByFolder, [id]: [] },
      currentFolderId: id,
      version: 1,
    };
    setStore(next);
  };

  const renameFolder = (id: ID) => {
    const f = storeRef.current.folders.find(x => x.id === id);
    if (!f) return;
    const title = prompt("フォルダー名を変更", f.title);
    if (!title) return;
    setStore(s => ({ ...s, folders: s.folders.map(x => (x.id === id ? { ...x, title } : x)) }));
  };

  const deleteFolder = (id: ID) => {
    if (!confirm("削除しますか？")) return;
    setStore(s => {
      const remain = s.folders.filter(x => x.id !== id);
      const { [id]: _, ...notesByFolder } = s.notesByFolder;
      return {
        ...s,
        folders: remain,
        notesByFolder,
        currentFolderId: s.currentFolderId === id ? remain[0]?.id : s.currentFolderId,
      };
    });
  };

  const switchFolder = (id: ID) => setStore(s => ({ ...s, currentFolderId: id }));

  /* ===== ノート ===== */
  const addNote = (folderId: ID) => {
    const title = prompt("ノートのタイトル", "新しいノート");
    if (!title) return;
    const newNote: Note = {
      id: uid(),
      title,
      subnotes: [
        { id: uid(), title: "課題点", content: "" },
        { id: uid(), title: "計画", content: "" },
      ],
    };
    setStore(s => ({
      ...s,
      notesByFolder: {
        ...s.notesByFolder,
        [folderId]: [...(s.notesByFolder[folderId] || []), newNote],
      },
    }));
  };

  const renameNote = (folderId: ID, noteId: ID) => {
    const note = (storeRef.current.notesByFolder[folderId] || []).find(n => n.id === noteId);
    if (!note) return;
    const title = prompt("ノートのタイトルを変更", note.title);
    if (!title) return;
    setStore(s => ({
      ...s,
      notesByFolder: {
        ...s.notesByFolder,
        [folderId]: (s.notesByFolder[folderId] || []).map(n => n.id === noteId ? { ...n, title } : n),
      },
    }));
  };

  const deleteNote = (folderId: ID, noteId: ID) => {
    if (!confirm("削除しますか？")) return;
    setStore(s => ({
      ...s,
      notesByFolder: {
        ...s.notesByFolder,
        [folderId]: (s.notesByFolder[folderId] || []).filter(n => n.id !== noteId),
      },
    }));
  };

  /* ===== 小ノート ===== */
  const addSubNote = (folderId: ID, noteId: ID) => {
    const title = prompt("小ノートのタイトル", "小ノート");
    if (!title) return;
    setStore(s => ({
      ...s,
      notesByFolder: {
        ...s.notesByFolder,
        [folderId]: (s.notesByFolder[folderId] || []).map(n =>
          n.id === noteId
            ? { ...n, subnotes: [...n.subnotes, { id: uid(), title, content: "" }] }
            : n
        ),
      },
    }));
  };

  const updateSubNote = (folderId: ID, noteId: ID, subId: ID, content: string) => {
    setStore(s => ({
      ...s,
      notesByFolder: {
        ...s.notesByFolder,
        [folderId]: (s.notesByFolder[folderId] || []).map(n =>
          n.id === noteId
            ? { ...n, subnotes: n.subnotes.map(sn => sn.id === subId ? { ...sn, content } : sn) }
            : n
        ),
      },
    }));
  };

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      {/* 左：フォルダー */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">フォルダー</h2>
          <button onClick={addFolder} className="rounded-lg border px-2 py-1 text-sm">＋</button>
        </div>
        {folders.map(f => (
          <div
            key={f.id}
            className={`flex justify-between items-center px-2 py-1 rounded-lg ${
              currentFolderId === f.id ? "bg-gray-50 border" : ""
            }`}
          >
            <button onClick={() => switchFolder(f.id)}>{f.title}</button>
            <div className="flex gap-1">
              <button onClick={() => renameFolder(f.id)} className="text-xs border px-1">名</button>
              <button onClick={() => deleteFolder(f.id)} className="text-xs border px-1">削</button>
            </div>
          </div>
        ))}
      </section>

      {/* 右：ノートと小ノート */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex justify-between mb-2">
          <h2 className="font-semibold">{currentFolder?.title ?? "ノート"}</h2>
          {currentFolderId && (
            <button onClick={() => addNote(currentFolderId)} className="rounded-lg border px-2 py-1 text-sm">ノート追加</button>
          )}
        </div>

        {currentNotes.map(n => (
          <div key={n.id} className="rounded-xl border p-3 mb-3">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold">{n.title}</h3>
              <div className="flex gap-1">
                <button onClick={() => renameNote(currentFolderId!, n.id)} className="text-xs border px-1">名</button>
                <button onClick={() => deleteNote(currentFolderId!, n.id)} className="text-xs border px-1">削</button>
                <button onClick={() => addSubNote(currentFolderId!, n.id)} className="text-xs border px-1">＋小</button>
              </div>
            </div>

            {n.subnotes.map(sn => (
              <div key={sn.id} className="border rounded-lg p-2 mb-2">
                <p className="text-sm font-medium mb-1">{sn.title}</p>
                <textarea
                  value={sn.content}
                  onChange={(e) => updateSubNote(currentFolderId!, n.id, sn.id, e.target.value)}
                  className="w-full border rounded-lg px-2 py-1 text-sm min-h-[80px]"
                  placeholder="ここに記入..."
                />
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
