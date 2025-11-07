// src/features/study/DevPlan.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDeviceId } from "@/lib/device";
import { pullBatch, pushGeneric, type TableName } from "@/lib/sync";

type ID = string;

/* ====== 同期テーブル名 ====== */
const TBL_FOLDERS = "devplan_folders";
const TBL_NOTES = "devplan_notes";

/* ====== サーバ行型（LWW共通ヘッダ） ====== */
type SyncBase = {
  id: ID;
  user_id: string;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
};
type FolderRow = SyncBase & { title: string };
type NoteRow = SyncBase & { folder_id: ID; title: string };

/* ====== ユーティリティ ====== */
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

export function DevPlan() {
  const userId = "demo"; // 認証導入時に差し替え
  const deviceId = getDeviceId();

  const [folders, setFolders] = useState<Map<ID, FolderRow>>(new Map());
  const [notes, setNotes] = useState<Map<ID, NoteRow>>(new Map());
  const [currentFolderId, setCurrentFolderId] = useState<ID | null>(null);

  const sinceRef = useRef<number>(0);
  const pullingRef = useRef(false);
  const seededRef = useRef(false);

  /* 初回＆定期 pull */
  useEffect(() => {
    const s = Number(localStorage.getItem(SINCE_KEY(userId)) || 0);
    sinceRef.current = Number.isFinite(s) ? s : 0;
    void doPull(true, false); // 初回は通常pull

    const t = setInterval(() => doPull(false, false), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doPull = useCallback(
    async (allowSeed = false, forceFull = false) => {
      if (pullingRef.current) return;
      pullingRef.current = true;
      try {
        const tables: TableName[] = [TBL_FOLDERS, TBL_NOTES];
        const since = forceFull ? 0 : sinceRef.current;
        const resp = await pullBatch(userId, since, tables);
        const diffs = resp?.diffs ?? {};

        const rFolders = (diffs as any)[TBL_FOLDERS] as FolderRow[] | undefined;
        const rNotes   = (diffs as any)[TBL_NOTES]   as NoteRow[]   | undefined;

        if (rFolders?.length) {
          setFolders((prev) => {
            const m = new Map(prev);
            lwwMerge(m, rFolders);
            return m;
          });
        }
        if (rNotes?.length) {
          setNotes((prev) => {
            const m = new Map(prev);
            lwwMerge(m, rNotes);
            return m;
          });
        }

        if (typeof resp?.server_time_ms === "number" && (!forceFull || resp.server_time_ms > sinceRef.current)) {
          sinceRef.current = resp.server_time_ms;
          localStorage.setItem(SINCE_KEY(userId), String(resp.server_time_ms));
        }

        // 初回シード（データ皆無なら4フォルダーだけ投入）
        if (
          allowSeed &&
          !seededRef.current &&
          (rFolders?.length ?? 0) === 0 &&
          folders.size === 0
        ) {
          seededRef.current = true;
          const baseTitles = ["先延ばし対策", "睡眠管理", "勉強", "Mental"];
          const rows = baseTitles.map((title) => ({ id: uid(), data: { title } }));
          await pushGeneric({ table: TBL_FOLDERS, userId, deviceId, rows });
          // シード直後はフルpullで確実に反映
          await doPull(false, true);
        }

        // 初期選択
        if (!currentFolderId) {
          const first =
            Array.from(folders.values()).find((f) => !f.deleted_at)?.id ??
            rFolders?.find((f) => !f.deleted_at)?.id ??
            null;
          if (first) setCurrentFolderId(first);
        }
      } catch (e) {
        // console.warn("[devplan] pull error:", e);
      } finally {
        pullingRef.current = false;
      }
    },
    [currentFolderId, folders, userId, deviceId]
  );

  /* ===== フォルダー操作 ===== */
  const addFolder = async () => {
    const title = prompt("新しいフォルダー名", "新しいフォルダー");
    if (!title) return;
    const id = uid();
    // 楽観的反映
    setFolders((prev) => {
      const m = new Map(prev);
      m.set(id, {
        id,
        title,
        user_id: userId,
        updated_at: Date.now(),
        updated_by: deviceId,
        deleted_at: null,
      } as FolderRow);
      return m;
    });
    await pushGeneric({
      table: TBL_FOLDERS,
      userId,
      deviceId,
      rows: [{ id, data: { title } }],
    });
    // 追加直後はフルpull（since=0）
    await doPull(false, true);
    setCurrentFolderId(id);
  };

  const renameFolder = async (id: ID) => {
    const f = folders.get(id);
    if (!f) return;
    const title = prompt("フォルダー名を変更", f.title);
    if (!title) return;
    await pushGeneric({
      table: TBL_FOLDERS,
      userId,
      deviceId,
      rows: [{ id, data: { title } }],
    });
    await doPull(false, true);
  };

  const deleteFolder = async (id: ID) => {
    if (!confirm("このフォルダーを削除しますか？（配下のノートも論理削除）")) return;
    await pushGeneric({
      table: TBL_FOLDERS,
      userId,
      deviceId,
      rows: [{ id, deleted_at: Date.now() }],
    });
    await doPull(false, true);
    setCurrentFolderId(null);
  };

  const switchFolder = (id: ID) => setCurrentFolderId(id);

  /* ===== ノート操作（一覧側） ===== */
  const addNote = async (folderId: ID) => {
    const title = prompt("ノートのタイトル（機能名など）", "新しいノート");
    if (!title) return;
    const id = uid();

    // 楽観的反映（すぐに一覧へ出す）
    setNotes((prev) => {
      const m = new Map(prev);
      m.set(id, {
        id,
        folder_id: folderId,
        title,
        user_id: userId,
        updated_at: Date.now(),
        updated_by: deviceId,
        deleted_at: null,
      } as NoteRow);
      return m;
    });

    await pushGeneric({
      table: TBL_NOTES,
      userId,
      deviceId,
      rows: [{ id, folder_id: folderId, data: { title } }],
    });

    // 追加直後はフルpullで確実に取得（クロックスキュー対策）
    await doPull(false, true);
  };

  const renameNote = async (folderId: ID, noteId: ID) => {
    const n = notes.get(noteId);
    if (!n || n.folder_id !== folderId) return;
    const title = prompt("ノートのタイトルを変更", n.title);
    if (!title) return;
    await pushGeneric({
      table: TBL_NOTES,
      userId,
      deviceId,
      rows: [{ id: noteId, folder_id: folderId, data: { title } }],
    });
    await doPull(false, true);
  };

  const deleteNote = async (folderId: ID, noteId: ID) => {
    const n = notes.get(noteId);
    if (!n || n.folder_id !== folderId) return;
    if (!confirm("このノートを削除しますか？（配下の小ノートも論理削除）")) return;
    await pushGeneric({
      table: TBL_NOTES,
      userId,
      deviceId,
      rows: [{ id: noteId, folder_id: folderId, deleted_at: Date.now() }],
    });
    await doPull(false, true);
  };

  /* ===== 派生ビュー ===== */
  const folderList = useMemo(
    () =>
      Array.from(folders.values())
        .filter((f) => !f.deleted_at)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [folders]
  );

  const notesInCurrent = useMemo(
    () =>
      currentFolderId
        ? Array.from(notes.values())
            .filter((n) => !n.deleted_at && n.folder_id === currentFolderId)
            .sort((a, b) => a.title.localeCompare(b.title))
        : [],
    [notes, currentFolderId]
  );

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

      {/* 右：ノート一覧 */}
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
