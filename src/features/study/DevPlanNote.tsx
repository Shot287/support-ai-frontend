// src/features/study/dev-plan/DevPlanNoteDetail.tsx
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

// 同期系定数
const DOC_KEY = "devplan_v1";
const LOCAL_KEY = "devplan_v1";
const SYNC_CHANNEL = "support-ai-sync";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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

export function DevPlanNoteDetail({
  folderId,
  noteId,
}: {
  folderId: string;
  noteId: string;
}) {
  // ① ローカルのみで初期ロード
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
    if (store) saveLocal(store);
  }, [store]);

  // ② 手動同期の合図を購読（📥/☁/RESET）
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
          console.warn("[DevPlanNoteDetail] manual PULL failed:", e);
        }
      },
      push: async () => {
        try {
          const cur = storeRef.current ?? loadLocal() ?? createInitialStore();
          await saveUserDoc<Store>(DOC_KEY, cur);
        } catch (e) {
          console.warn("[DevPlanNoteDetail] manual PUSH failed:", e);
        }
      },
      reset: async () => {
        /* no-op */
      },
    });
    return unsubscribe;
  }, []);

  // ③ ホームからのローカル適用通知 & storage 変化を購読
  useEffect(() => {
    if (typeof window === "undefined") return;

    let bc: BroadcastChannel | null = null;
    try {
      if ("BroadcastChannel" in window) {
        bc = new BroadcastChannel(SYNC_CHANNEL);
        bc.onmessage = (ev) => {
          const msg = ev?.data;
          if (msg && msg.type === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            const fresh = loadLocal();
            if (fresh) setStore(fresh);
          }
        };
      }
    } catch {
      // noop
    }

    const onWinMsg = (ev: MessageEvent) => {
      const msg = ev?.data;
      if (msg && msg.type === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
        const fresh = loadLocal();
        if (fresh) setStore(fresh);
      }
    };
    window.addEventListener("message", onWinMsg);

    const onStorage = (ev: StorageEvent) => {
      if (ev.key === LOCAL_KEY && ev.newValue) {
        try {
          const parsed = JSON.parse(ev.newValue) as Store;
          if (parsed?.version === 1) setStore(parsed);
        } catch {
          // noop
        }
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      if (bc) {
        try {
          bc.close();
        } catch {}
      }
      window.removeEventListener("message", onWinMsg);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  if (!store) {
    return <div className="text-sm text-gray-500">ノートを読み込み中です…</div>;
  }

  const folder = store.folders.find((f) => f.id === folderId);
  const note = (store.notesByFolder[folderId] || []).find((n) => n.id === noteId);

  // 操作：ノート名／小ノート CRUD
  const renameNote = () => {
    if (!note) return;
    const title = prompt("ノートのタイトルを変更", note.title);
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

  const addSubNote = () => {
    const title = prompt("小ノートのタイトル", "小ノート");
    if (!title) return;
    setStore((s) =>
      s
        ? {
            ...s,
            notesByFolder: {
              ...s.notesByFolder,
              [folderId]: (s.notesByFolder[folderId] || []).map((n) =>
                n.id === noteId
                  ? { ...n, subnotes: [...n.subnotes, { id: uid(), title, content: "" }] }
                  : n
              ),
            },
          }
        : s
    );
  };

  const renameSub = (subId: ID) => {
    if (!note) return;
    const target = note.subnotes.find((x) => x.id === subId);
    if (!target) return;
    const title = prompt("小ノートのタイトルを変更", target.title);
    if (!title) return;
    setStore((s) =>
      s
        ? {
            ...s,
            notesByFolder: {
              ...s.notesByFolder,
              [folderId]: (s.notesByFolder[folderId] || []).map((n) =>
                n.id === noteId
                  ? {
                      ...n,
                      subnotes: n.subnotes.map((sn) => (sn.id === subId ? { ...sn, title } : sn)),
                    }
                  : n
              ),
            },
          }
        : s
    );
  };

  const deleteSub = (subId: ID) => {
    if (!confirm("この小ノートを削除しますか？")) return;
    setStore((s) =>
      s
        ? {
            ...s,
            notesByFolder: {
              ...s.notesByFolder,
              [folderId]: (s.notesByFolder[folderId] || []).map((n) =>
                n.id === noteId ? { ...n, subnotes: n.subnotes.filter((sn) => sn.id !== subId) } : n
              ),
            },
          }
        : s
    );
  };

  const updateContent = (subId: ID, content: string) => {
    setStore((s) =>
      s
        ? {
            ...s,
            notesByFolder: {
              ...s.notesByFolder,
              [folderId]: (s.notesByFolder[folderId] || []).map((n) =>
                n.id === noteId
                  ? {
                      ...n,
                      subnotes: n.subnotes.map((sn) => (sn.id === subId ? { ...sn, content } : sn)),
                    }
                  : n
              ),
            },
          }
        : s
    );
  };

  if (!folder || !note) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-600">ノートが見つかりませんでした。</p>
        <Link href="/study/dev-plan" className="text-blue-600 hover:underline text-sm">
          一覧に戻る
        </Link>
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
          <button onClick={renameNote} className="rounded-lg border px-2 py-1 text-xs">
            ノート名変更
          </button>
          <button onClick={addSubNote} className="rounded-lg border px-2 py-1 text-xs">
            小ノート追加
          </button>
          <Link href={`/study/dev-plan`} className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50">
            一覧へ
          </Link>
        </div>
      </div>

      {note.subnotes.length === 0 ? (
        <p className="text-sm text-gray-500">小ノートがありません。「小ノート追加」で作成してください。</p>
      ) : (
        <div className="space-y-3">
          {note.subnotes.map((sn) => (
            <section key={sn.id} className="rounded-xl border p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{sn.title}</span>
                  <span className="text-xs text-gray-500">（編集可）</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => renameSub(sn.id)} className="rounded-lg border px-2 py-1 text-xs">
                    名
                  </button>
                  <button onClick={() => deleteSub(sn.id)} className="rounded-lg border px-2 py-1 text-xs">
                    削
                  </button>
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
