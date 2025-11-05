// src/features/study/DevPlanNote.tsx
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

const TBL_NOTES = "devplan_notes";
const TBL_SUBS = "devplan_subnotes";

type ID = string;

type SyncBase = {
  id: ID;
  user_id: string;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
};

type NoteRow = SyncBase & { folder_id: ID; title: string };
type SubRow = SyncBase & { note_id: ID; title: string; content: string };

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

function announceGlobalPull(userId: string, deviceId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("GLOBAL_SYNC_PULL", { detail: { userId, deviceId } }));
}

export function DevPlanNoteDetail({ folderId, noteId }: { folderId: string; noteId: string }) {
  const userId = "demo"; // TODO: 認証導入時に置換
  const deviceId = getDeviceId();

  const [notes, setNotes] = useState<Map<ID, NoteRow>>(new Map());
  const [subs, setSubs] = useState<Map<ID, SubRow>>(new Map());

  const sinceRef = useRef<number>(0);
  const pullingRef = useRef(false);

  useEffect(() => {
    const s = parseInt(localStorage.getItem(SINCE_KEY(userId)) || "0", 10) || 0;
    sinceRef.current = s;
    void doPull();

    const t = setInterval(() => doPull(), 4000);
    const onGlobalPull = () => doPull();
    window.addEventListener("GLOBAL_SYNC_PULL", onGlobalPull as any);
    return () => {
      clearInterval(t);
      window.removeEventListener("GLOBAL_SYNC_PULL", onGlobalPull as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doPull = useCallback(async () => {
    if (pullingRef.current) return;
    pullingRef.current = true;
    try {
      const resp = await pullBatch(userId, sinceRef.current, [TBL_NOTES, TBL_SUBS]);

      const rNotes = pickTableDiffs<NoteRow>(resp.diffs, TBL_NOTES);
      const rSubs = pickTableDiffs<SubRow>(resp.diffs, TBL_SUBS);

      setNotes((prev) => {
        const m = new Map(prev);
        lwwMerge(m, rNotes);
        return m;
      });
      setSubs((prev) => {
        const m = new Map(prev);
        lwwMerge(m, rSubs);
        return m;
      });

      if (resp.server_time_ms > sinceRef.current) {
        sinceRef.current = resp.server_time_ms;
        localStorage.setItem(SINCE_KEY(userId), String(resp.server_time_ms));
      }
    } finally {
      pullingRef.current = false;
    }
  }, [userId]);

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
    // pushBatch 内で signalGlobalPull/markStickyPull 済み
    await doPull();
  };

  const note = useMemo(() => notes.get(noteId) ?? null, [notes, noteId]);
  const subList = useMemo(
    () =>
      Array.from(subs.values())
        .filter((s) => s.note_id === noteId)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [subs, noteId]
  );

  const renameNote = async () => {
    if (!note) return;
    const title = prompt("ノートのタイトルを変更", note.title);
    if (!title) return;
    const row: NoteRow = { ...note, title, updated_at: Date.now(), updated_by: deviceId };
    await pushRows({ [TBL_NOTES]: [row] });
  };

  const addSubNote = async () => {
    const title = prompt("小ノートのタイトル", "小ノート");
    if (!title) return;
    const row: SubRow = { id: uid(), note_id: noteId, title, content: "", ...nowBase() };
    await pushRows({ [TBL_SUBS]: [row] });
  };

  const addTemplate = async () => {
    const rows: SubRow[] = [
      { id: uid(), note_id: noteId, title: "課題点", content: "", ...nowBase() },
      { id: uid(), note_id: noteId, title: "計画", content: "", ...nowBase() },
    ];
    await pushRows({ [TBL_SUBS]: rows });
  };

  const renameSub = async (subId: ID) => {
    const target = subs.get(subId);
    if (!target) return;
    const title = prompt("小ノートのタイトルを変更", target.title);
    if (!title) return;
    const row: SubRow = { ...target, title, updated_at: Date.now(), updated_by: deviceId };
    await pushRows({ [TBL_SUBS]: [row] });
  };

  const deleteSub = async (subId: ID) => {
    if (!confirm("この小ノートを削除しますか？")) return;
    const target = subs.get(subId);
    if (!target) return;
    const del: SubRow = {
      ...target,
      deleted_at: Date.now(),
      updated_at: Date.now(),
      updated_by: deviceId,
    };
    await pushRows({ [TBL_SUBS]: [del] });
  };

  const updateContent = async (subId: ID, content: string) => {
    const target = subs.get(subId);
    if (!target) return;
    const row: SubRow = { ...target, content, updated_at: Date.now(), updated_by: deviceId };
    await pushRows({ [TBL_SUBS]: [row] });
  };

  if (!note || note.folder_id !== folderId) {
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
          <div className="text-xs text-gray-500">フォルダーID：{folderId}</div>
          <h1 className="text-xl font-semibold break-words">{note.title}</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={renameNote} className="rounded-lg border px-2 py-1 text-xs">
            ノート名変更
          </button>
          <button onClick={addSubNote} className="rounded-lg border px-2 py-1 text-xs">
            小ノート追加
          </button>
          <button onClick={addTemplate} className="rounded-lg border px-2 py-1 text-xs">
            テンプレ挿入
          </button>
          <Link href={`/study/dev-plan`} className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50">
            一覧へ
          </Link>
        </div>
      </div>

      {subList.length === 0 ? (
        <p className="text-sm text-gray-500">
          小ノートがありません。「小ノート追加」または「テンプレ挿入」で作成してください。
        </p>
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
