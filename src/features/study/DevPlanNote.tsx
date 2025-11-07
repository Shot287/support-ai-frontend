// src/features/study/DevPlanNote.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDeviceId } from "@/lib/device";
import { pullBatch, pushGeneric, type TableName } from "@/lib/sync";

type ID = string;

/* ====== 同期テーブル名 ====== */
const TBL_NOTES = "devplan_notes";
const TBL_SUBS  = "devplan_subnotes";

/* ====== サーバ行型 ====== */
type SyncBase = {
  id: ID;
  user_id: string;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
};
type NoteRow = SyncBase & { folder_id: ID; title: string };
type SubRow  = SyncBase & { note_id: ID; title: string; content: string };

const SINCE_KEY = (userId: string) => `support-ai:sync:since:${userId}:devplan`;

export function DevPlanNoteDetail({ folderId, noteId }: { folderId: string; noteId: string }) {
  const userId = "demo"; // 認証導入時に差し替え
  const deviceId = getDeviceId();

  const [note, setNote] = useState<NoteRow | null>(null);
  const [subs, setSubs] = useState<Map<ID, SubRow>>(new Map());

  const sinceRef = useRef<number>(0);
  const pullingRef = useRef(false);

  /* 初回＆定期 pull（★ 初回はフルpullを強制） */
  useEffect(() => {
    const s = Number(localStorage.getItem(SINCE_KEY(userId)) || 0);
    sinceRef.current = Number.isFinite(s) ? s : 0;

    // まずはフルpullで確実にノート本体と既存小ノートを取得
    void doPull(true);

    const t = setInterval(() => doPull(false), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId, noteId]);

  const doPull = useCallback(
    async (forceFull = false) => {
      if (pullingRef.current) return;
      pullingRef.current = true;
      try {
        const tables: TableName[] = [TBL_NOTES, TBL_SUBS];
        const since = forceFull ? 0 : sinceRef.current;
        const resp = await pullBatch(userId, since, tables);
        const diffs = resp?.diffs ?? {};

        const rNotes = (diffs as any)[TBL_NOTES] as NoteRow[] | undefined;
        const rSubs  = (diffs as any)[TBL_SUBS]  as SubRow[]  | undefined;

        if (rNotes?.length) {
          const target = rNotes.find((n) => n.id === noteId && n.folder_id === folderId && !n.deleted_at);
          if (target) setNote(target);
        }
        if (rSubs?.length) {
          setSubs((prev) => {
            const m = new Map(prev);
            for (const r of rSubs) {
              if (r.note_id !== noteId) continue;
              const cur = m.get(r.id);
              if (!cur || cur.updated_at <= r.updated_at) {
                if (r.deleted_at) m.delete(r.id);
                else m.set(r.id, r);
              }
            }
            return m;
          });
        }

        if (
          typeof resp?.server_time_ms === "number" &&
          (!forceFull || resp.server_time_ms > sinceRef.current)
        ) {
          sinceRef.current = resp.server_time_ms;
          localStorage.setItem(SINCE_KEY(userId), String(resp.server_time_ms));
        }
      } finally {
        pullingRef.current = false;
      }
    },
    [folderId, noteId, userId]
  );

  /* ✅ Hooks は常にトップレベルで呼ぶ */
  const subList = useMemo(
    () =>
      Array.from(subs.values())
        .filter((s) => !s.deleted_at)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [subs]
  );

  /* ====== 操作：ノート名／小ノート CRUD ====== */
  const renameNote = async () => {
    if (!note) return;
    const title = prompt("ノートのタイトルを変更", note.title);
    if (!title) return;
    await pushGeneric({
      table: TBL_NOTES,
      userId,
      deviceId,
      rows: [{ id: note.id, folder_id: folderId, data: { title } }],
    });
    await doPull(true); // フルpull
  };

  const addSubNote = async () => {
    const title = prompt("小ノートのタイトル", "小ノート");
    if (!title) return;

    const id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`) as ID;

    // 楽観的反映（即時に一覧へ見せる）
    setSubs((prev) => {
      const m = new Map(prev);
      m.set(id, {
        id,
        note_id: noteId,
        title,
        content: "",
        user_id: userId,
        updated_at: Date.now(),
        updated_by: deviceId,
        deleted_at: null,
      } as SubRow);
      return m;
    });

    await pushGeneric({
      table: TBL_SUBS,
      userId,
      deviceId,
      rows: [{ id, note_id: noteId, data: { title, content: "" } }],
    });

    // 追加直後はフルpullで取りこぼし防止
    await doPull(true);
  };

  const renameSub = async (subId: ID) => {
    const target = subs.get(subId);
    if (!target) return;
    const title = prompt("小ノートのタイトルを変更", target.title);
    if (!title) return;
    await pushGeneric({
      table: TBL_SUBS,
      userId,
      deviceId,
      rows: [{ id: subId, note_id: noteId, data: { title } }],
    });
    await doPull(true);
  };

  const deleteSub = async (subId: ID) => {
    if (!confirm("この小ノートを削除しますか？")) return;
    await pushGeneric({
      table: TBL_SUBS,
      userId,
      deviceId,
      rows: [{ id: subId, note_id: noteId, deleted_at: Date.now() }],
    });
    await doPull(true);
  };

  // 入力更新は軽くデバウンス
  const typingRef = useRef<Record<string, number>>({});
  const updateContent = async (subId: ID, content: string) => {
    const now = Date.now();
    typingRef.current[subId] = now;
    // ローカル即時反映
    setSubs((prev) => {
      const m = new Map(prev);
      const cur = m.get(subId);
      if (cur) m.set(subId, { ...cur, content });
      return m;
    });
    // 300ms デバウンスで push
    setTimeout(async () => {
      if (typingRef.current[subId] !== now) return;
      await pushGeneric({
        table: TBL_SUBS,
        userId,
        deviceId,
        rows: [{ id: subId, note_id: noteId, data: { content } }],
      });
      // 内容は頻繁なので通常pullでOK
      await doPull(false);
    }, 300);
  };

  /* ====== 表示 ====== */
  if (!note) {
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
          <div className="text-xs text-gray-500">フォルダー：{note.folder_id}</div>
          <h1 className="text-xl font-semibold break-words">{note.title}</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={renameNote} className="rounded-lg border px-2 py-1 text-xs">ノート名変更</button>
          <button onClick={addSubNote} className="rounded-lg border px-2 py-1 text-xs">小ノート追加</button>
          <Link href={`/study/dev-plan`} className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50">一覧へ</Link>
        </div>
      </div>

      {subList.length === 0 ? (
        <p className="text-sm text-gray-500">小ノートがありません。「小ノート追加」で作成してください。</p>
      ) : (
        <div className="space-y-3">
          {subList.map((sn) => (
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
