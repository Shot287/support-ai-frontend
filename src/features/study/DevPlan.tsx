// src/features/study/DevPlan.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDeviceId } from "@/lib/device";
import {
  pullBatch,
  pushGeneric,
  pickTableDiffs,
} from "@/lib/sync";
import type { GenericChangeRow } from "@/lib/sync";

/* =========================
 * 同期テーブル / 型
 * ========================= */
const TBL_FOLDERS = "devplan_folders";
const TBL_NOTES = "devplan_notes";

type ID = string;

type SyncBase = {
  id: ID;
  user_id: string;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
};

type FolderRow = SyncBase & { title: string };
type NoteRow = SyncBase & { folder_id: ID; title: string };

/* =========================
 * ユーティリティ
 * ========================= */
const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const SINCE_KEY = (userId: string) => `support-ai:sync:since:${userId}:devplan`;

function lwwMerge<T extends SyncBase>(dst: Map<ID, T>, incoming: T[]) {
  for (const r of incoming) {
    const cur = dst.get(r.id);
    if (!cur || cur.updated_at <= r.updated_at) {
      if (r.deleted_at) dst.delete(r.id);
      else dst.set(r.id, r);
    }
  }
}

/* =========================
 * 本体コンポーネント
 * ========================= */
export function DevPlan() {
  const userId = "demo"; // TODO: 認証導入時に置換
  const deviceId = getDeviceId();

  const [folders, setFolders] = useState<Map<ID, FolderRow>>(new Map());
  const [notes, setNotes] = useState<Map<ID, NoteRow>>(new Map());

  const [currentFolderId, setCurrentFolderId] = useState<ID | null>(null);

  const sinceRef = useRef<number>(0);
  const pullingRef = useRef(false);
  const seededRef = useRef(false);

  useEffect(() => {
    const s = parseInt(localStorage.getItem(SINCE_KEY(userId)) || "0", 10) || 0;
    sinceRef.current = s;
    void doPull(true);

    const t = setInterval(() => doPull(), 4000);
    const onGlobalPull = () => doPull();
    window.addEventListener("GLOBAL_SYNC_PULL", onGlobalPull as any);
    return () => {
      clearInterval(t);
      window.removeEventListener("GLOBAL_SYNC_PULL", onGlobalPull as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doPull = useCallback(
    async (allowSeed = false) => {
      if (pullingRef.current) return;
      pullingRef.current = true;
      try {
        const resp = await pullBatch(userId, sinceRef.current, [
          TBL_FOLDERS,
          TBL_NOTES,
        ]);

        const rFolders = pickTableDiffs<FolderRow>(resp.diffs, TBL_FOLDERS);
        const rNotes = pickTableDiffs<NoteRow>(resp.diffs, TBL_NOTES);

        setFolders((prev) => {
          const m = new Map(prev);
          lwwMerge(m, rFolders);
          return m;
        });
        setNotes((prev) => {
          const m = new Map(prev);
          lwwMerge(m, rNotes);
          return m;
        });

        // since 更新
        if (resp.server_time_ms > sinceRef.current) {
          sinceRef.current = resp.server_time_ms;
          localStorage.setItem(SINCE_KEY(userId), String(resp.server_time_ms));
        }

        // 初期選択
        if (!currentFolderId) {
          const first =
            rFolders[0]?.id ?? Array.from(folders.values())[0]?.id ?? null;
          if (first) setCurrentFolderId(first);
        }

        // 初期シード（サーバが空のとき）
        if (
          allowSeed &&
          !seededRef.current &&
          rFolders.length === 0 &&
          folders.size === 0
        ) {
          seededRef.current = true;
          await seedInitialFolders();
        }
      } finally {
        pullingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, currentFolderId, folders]
  );

  const nowBase = (): Omit<SyncBase, "id"> => ({
    user_id: userId,
    updated_at: Date.now(),
    updated_by: deviceId,
    deleted_at: null,
  });

  /** push（テーブルごと） */
  const pushRows = async (rowsByTable: Record<string, SyncBase[]>) => {
    for (const [table, rows] of Object.entries(rowsByTable)) {
      if (!rows?.length) continue;
      const payloadRows = rows as unknown as GenericChangeRow[];
      await pushGeneric({ table, userId, deviceId, rows: payloadRows });
    }
    // pushBatch 内で signalGlobalPull/markStickyPull は実行される
    await doPull();
  };

  const seedInitialFolders = async () => {
    const base = ["先延ばし対策", "睡眠管理", "勉強", "Mental"].map((title) => ({
      id: uid(),
      title,
      ...nowBase(),
    })) as FolderRow[];
    await pushRows({ [TBL_FOLDERS]: base });
    setCurrentFolderId(base[0].id);
  };

  /* ===== フォルダー操作 ===== */
  const addFolder = async () => {
    const title = prompt("新しいフォルダー名", "新しいフォルダー");
    if (!title) return;
    const row: FolderRow = { id: uid(), title, ...nowBase() };
    await pushRows({ [TBL_FOLDERS]: [row] });
    setCurrentFolderId(row.id);
  };

  const renameFolder = async (id: ID) => {
    const f = folders.get(id);
    if (!f) return;
    const title = prompt("フォルダー名を変更", f.title);
    if (!title) return;
    const row: FolderRow = {
      ...f,
      title,
      updated_at: Date.now(),
      updated_by: deviceId,
    };
    await pushRows({ [TBL_FOLDERS]: [row] });
  };

  const deleteFolder = async (id: ID) => {
    if (!confirm("このフォルダーを削除しますか？（配下のノートも論理削除）")) return;
    const f = folders.get(id);
    if (!f) return;
    const del: FolderRow = {
      ...f,
      deleted_at: Date.now(),
      updated_at: Date.now(),
      updated_by: deviceId,
    };
    await pushRows({ [TBL_FOLDERS]: [del] });
    setCurrentFolderId(null);
  };

  const switchFolder = (id: ID) => setCurrentFolderId(id);

  /* ===== ノート操作 ===== */
  const addNote = async (folderId: ID) => {
    const title = prompt("ノートのタイトル（機能名など）", "新しいノート");
    if (!title) return;
    const row: NoteRow = { id: uid(), folder_id: folderId, title, ...nowBase() };
    await pushRows({ [TBL_NOTES]: [row] });
  };

  const renameNote = async (folderId: ID, noteId: ID) => {
    const n = Array.from(notes.values()).find(
      (x) => x.id === noteId && x.folder_id === folderId
    );
    if (!n) return;
    const title = prompt("ノートのタイトルを変更", n.title);
    if (!title) return;
    const row: NoteRow = {
      ...n,
      title,
      updated_at: Date.now(),
      updated_by: deviceId,
    };
    await pushRows({ [TBL_NOTES]: [row] });
  };

  const deleteNote = async (folderId: ID, noteId: ID) => {
    if (!confirm("このノートを削除しますか？（配下の小ノートも論理削除）")) return;
    const n = Array.from(notes.values()).find(
      (x) => x.id === noteId && x.folder_id === folderId
    );
    if (!n) return;
    const del: NoteRow = {
      ...n,
      deleted_at: Date.now(),
      updated_at: Date.now(),
      updated_by: deviceId,
    };
    await pushRows({ [TBL_NOTES]: [del] });
  };

  /* ===== 表示用派生 ===== */
  const folderList = useMemo(
    () =>
      Array.from(folders.values()).sort((a, b) =>
        a.title.localeCompare(b.title)
      ),
    [folders]
  );

  const notesInCurrent = useMemo(
    () =>
      currentFolderId
        ? Array.from(notes.values()).filter((n) => n.folder_id === currentFolderId)
        : [],
    [notes, currentFolderId]
  );

  /* ===== UI ===== */
  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      {/* 左：フォルダー一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">フォルダー</h2>
          <button
            onClick={addFolder}
            className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            追加
          </button>
        </div>

        {folderList.length === 0 ? (
          <p className="text-sm text-gray-500">フォルダーがありません。</p>
        ) : (
          <ul className="space-y-1">
            {folderList.map((f) => (
              <li key={f.id}>
                <div
                  className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 ${
                    currentFolderId === f.id ? "bg-gray-50 border" : ""
                  }`}
                >
                  <button
                    onClick={() => switchFolder(f.id)}
                    className="text-left min-w-0 truncate"
                    title={f.title}
                  >
                    {f.title}
                  </button>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => renameFolder(f.id)}
                      className="rounded-lg border px-2 py-1 text-xs"
                    >
                      名
                    </button>
                    <button
                      onClick={() => deleteFolder(f.id)}
                      className="rounded-lg border px-2 py-1 text-xs"
                    >
                      削
                    </button>
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
          <h2 className="font-semibold">
            {currentFolderId ? "ノート" : "フォルダーを選択"}
          </h2>
          {currentFolderId && (
            <button
              onClick={() => addNote(currentFolderId)}
              className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              ノート追加
            </button>
          )}
        </div>

        {!currentFolderId ? (
          <p className="text-sm text-gray-500">フォルダーを選択してください。</p>
        ) : notesInCurrent.length === 0 ? (
          <p className="text-sm text-gray-500">
            ノートがありません。「ノート追加」で作成してください。
          </p>
        ) : (
          <ul className="space-y-2">
            {notesInCurrent.map((n) => (
              <li key={n.id} className="rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <Link
                    href={`/study/dev-plan/${currentFolderId}/${n.id}`}
                    className="font-semibold underline-offset-2 hover:underline break-words"
                  >
                    {n.title}
                  </Link>
                  <div className="flex gap-2">
                    <button
                      onClick={() => renameNote(currentFolderId, n.id)}
                      className="rounded-lg border px-2 py-1 text-xs"
                    >
                      名
                    </button>
                    <button
                      onClick={() => deleteNote(currentFolderId, n.id)}
                      className="rounded-lg border px-2 py-1 text-xs"
                    >
                      削
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  ※ クリックで詳細ページへ。小ノートは詳細で常時展開されます。
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
