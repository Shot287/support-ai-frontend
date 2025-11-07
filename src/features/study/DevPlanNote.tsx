// src/features/study/DevPlanNote.tsx
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
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : { folders: [], notesByFolder: {}, version: 1 };
  } catch {
    return { folders: [], notesByFolder: {}, version: 1 };
  }
}
function save(s: Store) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }

export function DevPlanNoteDetail({ folderId, noteId }: { folderId: string; noteId: string }) {
  const [store, setStore] = useState<Store>(() => load());
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; save(store); }, [store]);

  const folder = useMemo(() => store.folders.find(f => f.id === folderId), [store.folders, folderId]);
  const note = useMemo(() => (store.notesByFolder[folderId] || []).find(n => n.id === noteId), [store.notesByFolder, folderId, noteId]);

  // 操作：ノート名／小ノートCRUD
  const renameNote = () => {
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

  const addSubNote = () => {
    const title = prompt("小ノートのタイトル", "小ノート");
    if (!title) return;
    setStore(s => ({
      ...s,
      notesByFolder: {
        ...s.notesByFolder,
        [folderId]: (s.notesByFolder[folderId] || []).map(n =>
          n.id === noteId ? { ...n, subnotes: [...n.subnotes, { id: uid(), title, content: "" }] } : n
        ),
      },
    }));
  };

  const renameSub = (subId: ID) => {
    const target = note?.subnotes.find(x => x.id === subId);
    if (!target) return;
    const title = prompt("小ノートのタイトルを変更", target.title);
    if (!title) return;
    setStore(s => ({
      ...s,
      notesByFolder: {
        ...s.notesByFolder,
        [folderId]: (s.notesByFolder[folderId] || []).map(n =>
          n.id === noteId ? { ...n, subnotes: n.subnotes.map(sn => sn.id === subId ? { ...sn, title } : sn) } : n
        ),
      },
    }));
  };

  const deleteSub = (subId: ID) => {
    if (!confirm("この小ノートを削除しますか？")) return;
    setStore(s => ({
      ...s,
      notesByFolder: {
        ...s.notesByFolder,
        [folderId]: (s.notesByFolder[folderId] || []).map(n =>
          n.id === noteId ? { ...n, subnotes: n.subnotes.filter(sn => sn.id !== subId) } : n
        ),
      },
    }));
  };

  const updateContent = (subId: ID, content: string) => {
    setStore(s => ({
      ...s,
      notesByFolder: {
        ...s.notesByFolder,
        [folderId]: (s.notesByFolder[folderId] || []).map(n =>
          n.id === noteId ? { ...n, subnotes: n.subnotes.map(sn => sn.id === subId ? { ...sn, content } : sn) } : n
        ),
      },
    }));
  };

  if (!folder || !note) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-600">ノートが見つかりませんでした。</p>
        <Link href="/study/dev-plan" className="text-blue-600 hover:underline text-sm">一覧に戻る</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-500">フォルダー：{folder.title}</div>
          <h1 className="text-xl font-semibold break-words">{note.title}</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={renameNote} className="rounded-lg border px-2 py-1 text-xs">ノート名変更</button>
          <button onClick={addSubNote} className="rounded-lg border px-2 py-1 text-xs">小ノート追加</button>
          <Link href={`/study/dev-plan`} className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50">一覧へ</Link>
        </div>
      </div>

      {/* 小ノートは常時展開 */}
      {note.subnotes.length === 0 ? (
        <p className="text-sm text-gray-500">小ノートがありません。「小ノート追加」で作成してください。</p>
      ) : (
        <div className="space-y-3">
          {note.subnotes.map(sn => (
            <section key={sn.id} className="rounded-xl border p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{sn.title}</span>
                  <span className="text-xs text-gray-500">（編集可）</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => renameSub(sn.id)} className="rounded-lg border px-2 py-1 text-xs">名</button>
                  <button onClick={() => deleteSub(sn.id)} className="rounded-lg border px-2 py-1 text-xs">削</button>
                </div>
              </div>
              <textarea
                value={sn.content}
                onChange={(e) => updateContent(sn.id, e.target.value)}
                placeholder="ここに内容を記入…（課題点・計画・メモなど自由に）"
                className="w-full rounded-xl border px-3 py-2 text-sm min-h-[120px]"
              />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
