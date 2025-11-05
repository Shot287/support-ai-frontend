// src/features/study/DevPlan.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDeviceId } from "@/lib/device";
import { pullBatch, pushBatch } from "@/lib/sync"; // ← pushBatch に変更

/* =========================
 * 同期テーブル / 型
 * ========================= */
const TBL_FOLDERS = "devplan_folders";
const TBL_NOTES = "devplan_notes";

type ID = string;

type SyncBase = {
  id: ID;
  user_id: string;
  updated_at: number; // ms
  updated_by: string;
  deleted_at: number | null; // tombstone
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

/** LWW（Last-Write-Wins）マージ */
function lwwMerge<T extends SyncBase>(dst: Map<ID, T>, incoming: T[]) {
  for (const r of incoming) {
    const cur = dst.get(r.id);
    if (!cur || cur.updated_at <= r.updated_at) {
      if (r.deleted_at) dst.delete(r.id);
      else dst.set(r.id, r);
    }
  }
}

/** pullBatch の戻り互換吸収（since/rows の名称違いに対応） */
function getSince(res: unknown): number {
  const anyRes = res as any;
  return anyRes?.since ?? anyRes?.nextSince ?? anyRes?.cursor ?? anyRes?.next_cursor ?? 0;
}
function getTableRows<T = unknown>(res: unknown, table: string): T[] {
  const anyRes = res as any;
  return (
    anyRes?.rows?.[table] ??
    anyRes?.tables?.[table] ??
    anyRes?.data?.[table] ??
    anyRes?.[table] ??
    []
  );
}

/** 他タブへ「受信してね」を合図（ローカル実装） */
function announceGlobalPull(userId: string, deviceId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("GLOBAL_SYNC_PULL", { detail: { userId, deviceId } })
  );
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

  /* ===== 初回・定期Pull ===== */
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
        // pullBatch(userId, since, [tables...])
        const res = await pullBatch(userId, sinceRef.current, [
          TBL_FOLDERS,
          TBL_NOTES,
        ]);

        const nextSince = getSince(res);
        const rFolders = getTableRows<FolderRow>(res, TBL_FOLDERS);
        const rNotes = getTableRows<NoteRow>(res, TBL_NOTES);

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

        if (nextSince > sinceRef.current) {
          sinceRef.current = nextSince;
          localStorage.setItem(SINCE_KEY(userId), String(nextSince));
        }

        // 初回フォルダー選択
        if (!currentFolderId) {
          const first =
            rFolders[0]?.id ?? Array.from(folders.values())[0]?.id ?? null;
          if (first) setCurrentFolderId(first);
        }

        // まっさらな環境での初期フォルダー投入（1回だけ）
        if (allowSeed && !seededRef.current && rFolders.length === 0 && folders.size === 0) {
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

  /** push → 一括送信（pushBatch 1引数API）→ 各タブにPull合図 */
  const pushRows = async (rowsByTable: Record<string, SyncBase[]>) => {
    const REQUIRED: (keyof SyncBase)[] = ["id", "user_id", "updated_at", "updated_by"];

    // 送信前バリデーション
    for (const [table, rows] of Object.entries(rowsByTable)) {
      if (!rows || rows.length === 0) continue;
      for (const r of rows) {
        for (const k of REQUIRED) {
          if ((r as Record<string, unknown>)[k] == null) {
            console.error(`push skipped (missing '${String(k)}')`, { table, row: r });
          }
        }
      }
    }

    // 型：Record<string, unknown>[] で安全に渡す
    const payload: Record<string, Record<string, unknown>[]> = {};
    for (const [table, rows] of Object.entries(rowsByTable)) {
      if (!rows || rows.length === 0) continue;
      payload[table] = rows as unknown as Record<string, unknown>[];
    }

    await pushBatch(payload); // ← 1引数だけ

    announceGlobalPull(userId, deviceId);
    await doPull();
  };

  /* ===== 初期フォルダーのシード ===== */
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

  /* ===== ノート操作（一覧：親は閉じた表示） ===== */
  const addNote = async (folderId: ID) => {
    const title = prompt("ノートのタイトル（機能名など）", "新しいノート");
    if (!title) return;
    const row: NoteRow = {
      id: uid(),
      folder_id: folderId,
      title,
      ...nowBase(),
    };
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
    () => Array.from(folders.values()).sort((a, b) => a.title.localeCompare(b.title)),
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
              className="rounded-xl border px-3 py-1.5 textsm hover:bg-gray-50"
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
                  {/* タイトルクリックで詳細ページへ遷移 */}
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
