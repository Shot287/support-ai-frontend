// src/features/study/dev-plan/DevPlan.tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";

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
const LOCAL_KEY = KEY; // localStorage のキー=doc_key と同一で運用

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---- localStorage I/O ----
function loadLocal(): Store | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as Store) : null;
  } catch {
    return null;
  }
}
function saveLocal(s: Store) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
  } catch {
    // noop
  }
}

// 初期データ（ローカルが空のときのみ採用）
function createInitialStore(): Store {
  const baseFolders: Folder[] = [
    { id: uid(), title: "先延ばし対策" },
    { id: uid(), title: "睡眠管理" },
    { id: uid(), title: "勉強" },
    { id: uid(), title: "Mental" },
  ];
  const firstId = baseFolders[0]?.id;
  return {
    folders: baseFolders,
    notesByFolder: Object.fromEntries(baseFolders.map((f) => [f.id, [] as Note[]])),
    currentFolderId: firstId,
    version: 1,
  };
}

export function DevPlan() {
  // ① 初期読み込みはローカルのみ（サーバ取得は手動📥時）
  const [store, setStore] = useState<Store | null>(() => {
    const base = loadLocal();
    if (base) return base;
    const init = createInitialStore();
    saveLocal(init);
    return init;
  });
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
    if (store) saveLocal(store); // ② 変更はローカルへ即時保存（サーバへは手動☁時のみ）
  }, [store]);

  // ③ 手動同期の合図（ホームの 📥／☁）に反応
  useEffect(() => {
    const unsubscribe = registerManualSync({
      pull: async () => {
        try {
          const remote = await loadUserDoc<Store>(KEY);
          if (remote && remote.version === 1) {
            setStore(remote);
            saveLocal(remote);
          }
        } catch (e) {
          console.warn("[DevPlan] manual PULL failed:", e);
        }
      },
      push: async () => {
        try {
          const cur = storeRef.current ?? loadLocal() ?? createInitialStore();
          await saveUserDoc<Store>(KEY, cur);
        } catch (e) {
          console.warn("[DevPlan] manual PUSH failed:", e);
        }
      },
      reset: async () => {
        /* DevPlan は since 未使用のため特別処理なし */
      },
    });
    return unsubscribe;
  }, []);

  // ローディング（ローカルが null のケースは基本発生しないが一応）
  if (!store) return <div className="text-sm text-gray-500">開発計画を読み込み中です…</div>;

  const folders = store.folders;
  const currentFolderId = store.currentFolderId ?? folders[0]?.id;
  const currentFolder = folders.find((f) => f.id === currentFolderId);
  const notes: Note[] = currentFolderId ? store.notesByFolder[currentFolderId] || [] : [];

  /* ===== フォルダー操作 ===== */
  const addFolder = () => {
    const title = prompt("新しいフォルダー名", "新しいフォルダー");
    if (!title) return;
    const id = uid();
    setStore((s) =>
      s
        ? {
            ...s,
            folders: [...s.folders, { id, title }],
            notesByFolder: { ...s.notesByFolder, [id]: [] },
            currentFolderId: id,
          }
        : s
    );
  };

  const renameFolder = (id: ID) => {
    const target = store.folders.find((x) => x.id === id);
    if (!target) return;
    const title = prompt("フォルダー名を変更", target.title);
    if (!title) return;
    setStore((s) =>
      s
        ? { ...s, folders: s.folders.map((x) => (x.id === id ? { ...x, title } : x)) }
        : s
    );
  };

  const deleteFolder = (id: ID) => {
    if (!confirm("このフォルダーを削除しますか？（配下のノートも削除）")) return;
    setStore((s) => {
      if (!s) return s;
      const remain = s.folders.filter((x) => x.id !== id);
      const notesByFolder = { ...s.notesByFolder };
      delete notesByFolder[id];
      const nextCurrent = s.currentFolderId === id ? remain[0]?.id : s.currentFolderId;
      return { ...s, folders: remain, notesByFolder, currentFolderId: nextCurrent };
    });
  };

  const switchFolder = (id: ID) =>
    setStore((s) => (s ? { ...s, currentFolderId: id } : s));

  /* ===== ノート操作（一覧側） ===== */
  const addNote = (folderId: ID) => {
    const title = prompt("ノートのタイトル（機能名など）", "新しいノート");
    if (!title) return;
    const note: Note = {
      id: uid(),
      title,
      subnotes: [
        { id: uid(), title: "課題点", content: "" },
        { id: uid(), title: "計画", content: "" },
      ],
    };
    setStore((s) =>
      s
        ? {
            ...s,
            notesByFolder: {
              ...s.notesByFolder,
              [folderId]: [...(s.notesByFolder[folderId] || []), note],
            },
          }
        : s
    );
  };

  const renameNote = (folderId: ID, noteId: ID) => {
    const curNotes = store.notesByFolder[folderId] || [];
    const target = curNotes.find((n) => n.id === noteId);
    if (!target) return;
    const title = prompt("ノートのタイトルを変更", target.title);
    if (!title) return;
    setStore((s) =>
      s
        ? {
            ...s,
            notesByFolder: {
              ...s.notesByFolder,
              [folderId]: (s.notesByFolder[folderId] || []).map((n) =>
                n.id === noteId ? { ...n, title } : n
              ),
            },
          }
        : s
    );
  };

  const deleteNote = (folderId: ID, noteId: ID) => {
    if (!confirm("このノートを削除しますか？（配下の小ノートも削除）")) return;
    setStore((s) =>
      s
        ? {
            ...s,
            notesByFolder: {
              ...s.notesByFolder,
              [folderId]: (s.notesByFolder[folderId] || []).filter((n) => n.id !== noteId),
            },
          }
        : s
    );
  };

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      {/* 左：フォルダー一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">フォルダー</h2>
          <button onClick={addFolder} className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50">
            追加
          </button>
        </div>
        {folders.length === 0 ? (
          <p className="text-sm text-gray-500">フォルダーがありません。</p>
        ) : (
          <ul className="space-y-1">
            {folders.map((f) => (
              <li key={f.id}>
                <div
                  className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 ${
                    currentFolderId === f.id ? "bg-gray-50 border" : ""
                  }`}
                >
                  <button onClick={() => switchFolder(f.id)} className="text-left min-w-0 truncate" title={f.title}>
                    {f.title}
                  </button>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => renameFolder(f.id)} className="rounded-lg border px-2 py-1 text-xs">
                      名
                    </button>
                    <button onClick={() => deleteFolder(f.id)} className="rounded-lg border px-2 py-1 text-xs">
                      削
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 右：ノート一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">
            {currentFolder ? `「${currentFolder.title}」のノート` : "ノート"}
          </h2>
          {currentFolderId && (
            <button onClick={() => addNote(currentFolderId)} className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50">
              ノート追加
            </button>
          )}
        </div>

        {!currentFolderId || notes.length === 0 ? (
          <p className="text-sm text-gray-500">
            {currentFolderId ? "ノートがありません。「ノート追加」で作成してください。" : "フォルダーを選択してください。"}
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <Link href={`/study/dev-plan/${currentFolderId}/${n.id}`} className="font-semibold underline-offset-2 hover:underline break-words">
                    {n.title}
                  </Link>
                  <div className="flex gap-2">
                    <button onClick={() => renameNote(currentFolderId!, n.id)} className="rounded-lg border px-2 py-1 text-xs">
                      名
                    </button>
                    <button onClick={() => deleteNote(currentFolderId!, n.id)} className="rounded-lg border px-2 py-1 text-xs">
                      削
                    </button>
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
