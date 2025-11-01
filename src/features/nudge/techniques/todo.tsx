// src/features/nudge/techniques/todo.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// ▼ 同期ユーティリティ（汎用 pull/push を使用）
import { pullBatch, pushBatch } from "@/lib/sync";
import { subscribeGlobalPush } from "@/lib/sync-bus";
import { getDeviceId } from "@/lib/device";

/* ========= 型 ========= */
type ID = string;
type Task = {
  id: ID;
  title: string;
  deadline: string;  // YYYY-MM-DD (JST基準)
  createdAt: number; // ローカル専用（サーバには保存しない）
  doneAt?: number;   // 完了時刻(ms)。未完了は undefined
};
type Store = { tasks: Task[]; version: 1 };

/* ========= 定数 / ユーティリティ ========= */
const KEY = "todo_v1";

// ★ 同期関連
const USER_ID = "demo"; // 認証導入までは固定運用
const TABLE = "todo_items";
const SINCE_KEY = `support-ai:sync:since:${USER_ID}:${TABLE}`;
const STICKY_KEY = "support-ai:sync:pull:sticky";

// 粘着フラグ（直近 push の印）
const touchSticky = () => {
  try { localStorage.setItem(STICKY_KEY, String(Date.now())); } catch {}
};
const getSince = () => {
  const v = typeof window !== "undefined" ? localStorage.getItem(SINCE_KEY) : null;
  return v ? Number(v) : 0;
};
const setSince = (ms: number) => {
  if (typeof window !== "undefined") localStorage.setItem(SINCE_KEY, String(ms));
};

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// JSTの今日 YYYY-MM-DD
function todayJst(): string {
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = p.find(x => x.type === "year")?.value ?? "1970";
  const m = p.find(x => x.type === "month")?.value ?? "01";
  const d = p.find(x => x.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

// “その日の JST 23:59:59.999” までの残り日数（当日=0、期限超過は負数）
function daysLeftJST(yyyyMmDd: string): number {
  const end = Date.parse(`${yyyyMmDd}T23:59:59.999+09:00`);
  const now = Date.now();
  const diffDays = (end - now) / 86400000;
  return Math.floor(diffDays);
}

function load(): Store {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return { tasks: [], version: 1 };
    const parsed = JSON.parse(raw) as Store;
    return parsed?.version ? parsed : { tasks: [], version: 1 };
  } catch {
    return { tasks: [], version: 1 };
  }
}
function save(s: Store) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s));
}

function badgeClass(left: number): string {
  if (left < 0) return "bg-red-600 text-white";
  if (left === 0) return "bg-orange-500 text-white";
  if (left <= 7) return "bg-yellow-300 text-gray-900";
  return "bg-gray-200 text-gray-900";
}

/* ========= 本体 ========= */
export default function TodoTechnique() {
  const [store, setStore] = useState<Store>(() => load());
  const storeRef = useRef(store);
  useEffect(() => save(store), [store]);
  useEffect(() => { storeRef.current = store; }, [store]);

  // 追加フォーム
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState<string>(() => todayJst());
  const inputRef = useRef<HTMLInputElement | null>(null);

  const tasksSorted = useMemo(() => {
    const a = store.tasks.slice();
    // 1) 未完了 → 完了の順
    // 2) 未完了内は残日数昇順 → 期限同じなら作成古い順
    // 3) 完了内は完了時刻の新しい順
    a.sort((A, B) => {
      const doneA = !!A.doneAt;
      const doneB = !!B.doneAt;
      if (doneA !== doneB) return doneA ? 1 : -1;

      if (!doneA && !doneB) {
        const dA = daysLeftJST(A.deadline);
        const dB = daysLeftJST(B.deadline);
        if (dA !== dB) return dA - dB;
        return A.createdAt - B.createdAt;
      }
      // 両方完了
      return (B.doneAt ?? 0) - (A.doneAt ?? 0);
    });
    return a;
  }, [store.tasks]);

  /* ========= 同期：受信（PULL） ========= */

  // サーバ差分 → ローカルへ反映（LWW）
  const applyTaskDiffs = (rows: Array<{
    id: string;
    user_id: string;
    title?: string | null;
    deadline?: string | null;
    done_at?: number | null;
    updated_at: number;
    updated_by?: string | null;
    deleted_at?: number | null;
  }>) => {
    if (!rows || rows.length === 0) return;

    setStore((prev) => {
      // id → index
      const idx = new Map(prev.tasks.map((e, i) => [e.id, i] as const));
      const tasks = prev.tasks.slice();

      for (const r of rows) {
        const del = r.deleted_at ? Number(r.deleted_at) : null;

        if (del) {
          const i = idx.get(r.id);
          if (i !== undefined) {
            tasks.splice(i, 1);
            // index 再構築
            idx.clear();
            tasks.forEach((e, k) => idx.set(e.id, k));
          }
          continue;
        }

        const i = idx.get(r.id);
        if (i === undefined) {
          // 追加（createdAt は updated_at を代替）
          tasks.unshift({
            id: r.id,
            title: String(r.title ?? ""),
            deadline: String(r.deadline ?? todayJst()),
            createdAt: r.updated_at ?? Date.now(),
            doneAt: r.done_at ?? undefined,
          });
          idx.set(r.id, 0);
        } else {
          const cur = tasks[i];
          tasks[i] = {
            ...cur,
            title: r.title != null ? String(r.title) : cur.title,
            deadline: r.deadline != null ? String(r.deadline) : cur.deadline,
            doneAt: r.done_at != null ? Number(r.done_at) : cur.doneAt,
            // createdAt は保持（サーバ未管理）
          };
        }
      }

      return { ...prev, tasks };
    });
  };

  // 受信本体
  const doPullAll = async () => {
    try {
      const json = await pullBatch(USER_ID, getSince(), [TABLE]);
      const rows = (json.diffs?.[TABLE] ?? []) as any[];
      applyTaskDiffs(rows);
      setSince(json.server_time_ms);
    } catch (e) {
      console.warn("[todo] pull-batch failed:", e);
    }
  };

  // 初回＋粘着フラグ＋フォーカス復帰
  useEffect(() => {
    void doPullAll();

    // 粘着フラグ：直近5分は自動再PULL
    try {
      const sticky = localStorage.getItem(STICKY_KEY);
      if (sticky && Date.now() - Number(sticky) <= 5 * 60 * 1000) {
        void doPullAll();
      }
    } catch {}

    const onFocusLike = () => {
      try {
        const sticky = localStorage.getItem(STICKY_KEY);
        if (sticky && Date.now() - Number(sticky) <= 5 * 60 * 1000) {
          void doPullAll();
        }
      } catch {}
    };
    window.addEventListener("focus", onFocusLike);
    document.addEventListener("visibilitychange", onFocusLike);
    return () => {
      window.removeEventListener("focus", onFocusLike);
      document.removeEventListener("visibilitychange", onFocusLike);
    };
  }, []);

  // ホームの「🔄 同期（受信）」/「RESET」の合図を購読
  useEffect(() => {
    const handler = (payload: any) => {
      if (!payload) return;
      if (payload.type === "GLOBAL_SYNC_PULL") {
        void doPullAll();
      } else if (payload.type === "GLOBAL_SYNC_RESET") {
        try { localStorage.setItem(SINCE_KEY, "0"); } catch {}
        setStore((s) => ({ ...s, tasks: [] }));
        void doPullAll();
      }
    };

    // BroadcastChannel
    let bc: BroadcastChannel | undefined;
    try {
      if ("BroadcastChannel" in window) {
        bc = new BroadcastChannel("support-ai-sync");
        bc.onmessage = (e) => handler(e.data);
      }
    } catch {}

    // postMessage
    const onPostMessage = (e: MessageEvent) => handler(e.data);
    window.addEventListener("message", onPostMessage);

    // storage（他タブ由来）
    const onStorage = (e: StorageEvent) => {
      if (e.key === "support-ai:sync:pull:req" && e.newValue) {
        try { handler(JSON.parse(e.newValue)); } catch {}
      }
      if (e.key === "support-ai:sync:reset:req" && e.newValue) {
        try { handler(JSON.parse(e.newValue)); } catch {}
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      try { bc?.close(); } catch {}
      window.removeEventListener("message", onPostMessage);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /* ========= 同期：送信（PUSH） ========= */

  // 共通 push（1件）
  const pushOne = async (t: Task, deleted = false) => {
    try {
      const deviceId = getDeviceId();
      const now = Date.now();

      // ChangeRow（sync API 仕様）
      const row = {
        id: t.id,
        updated_at: now,
        updated_by: deviceId,
        deleted_at: deleted ? now : null,
        // todo_items は固定FKなし。ペイロード列を data に入れる。
        data: deleted
          ? {}
          : {
              title: t.title,
              deadline: t.deadline,
              done_at: t.doneAt ?? null,
            },
      };

      await pushBatch({
        user_id: USER_ID,
        device_id: deviceId,
        changes: { [TABLE]: [row] },
      });

      // 粘着フラグ → 直後PULL
      touchSticky();
      await doPullAll();
    } catch (err) {
      console.warn("[todo] pushOne failed:", err);
    }
  };

  // 手動全量アップロード（ホームの「☁ 手動アップロード」に反応）
  const manualPushAll = async () => {
    try {
      const snapshot = storeRef.current;
      const deviceId = getDeviceId();
      const now = Date.now();

      const rows = snapshot.tasks.map((t) => ({
        id: t.id,
        updated_at: now,
        updated_by: deviceId,
        deleted_at: null,
        data: {
          title: t.title,
          deadline: t.deadline,
          done_at: t.doneAt ?? null,
        },
      }));

      if (rows.length > 0) {
        await pushBatch({
          user_id: USER_ID,
          device_id: deviceId,
          changes: { [TABLE]: rows },
        });
      }
      touchSticky();
      await doPullAll();
    } catch (e) {
      console.warn("[todo] manualPushAll failed:", e);
    }
  };

  // グローバルPush合図を購読
  useEffect(() => {
    const unSub = subscribeGlobalPush((p) => {
      if (!p || p.userId !== USER_ID) return;
      void manualPushAll();
    });
    return () => {
      try { unSub(); } catch {}
    };
  }, []);

  /* ========= CRUD（ローカル更新＋即時PUSH） ========= */

  const add = () => {
    const t = title.trim();
    const d = deadline.trim();
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      alert("タスク名と締め切り日（YYYY-MM-DD）を入力してください。");
      return;
    }
    const item: Task = { id: uid(), title: t, deadline: d, createdAt: Date.now() };
    setStore(s => ({ ...s, tasks: [item, ...s.tasks] }));
    setTitle("");
    inputRef.current?.focus();

    void pushOne(item, false);
  };

  const toggleDone = (id: ID) => {
    let changed: Task | null = null;
    setStore(s => {
      const tasks = s.tasks.map(x =>
        x.id === id ? (changed = { ...x, doneAt: x.doneAt ? undefined : Date.now() }) : x
      ) as Task[];
      return { ...s, tasks };
    });
    if (changed) void pushOne(changed, false);
  };

  const remove = (id: ID) => {
    const target = storeRef.current.tasks.find((e) => e.id === id);
    setStore(s => ({ ...s, tasks: s.tasks.filter(x => x.id !== id) }));
    if (target) void pushOne(target, true);
  };

  const clearCompleted = () => {
    const completed = storeRef.current.tasks.filter((x) => !!x.doneAt);
    if (completed.length === 0) return;
    (async () => {
      for (const t of completed) {
        await pushOne(t, true);
      }
    })();
    setStore(s => ({ ...s, tasks: s.tasks.filter(x => !x.doneAt) }));
  };

  // JSON 入出力（ローカルのみ。必要なら全量PUSHボタンで反映可能）
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `todo_export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Store;
        if (!parsed?.version) throw new Error();
        setStore(parsed);
        alert("インポートしました。必要ならホームの『☁ 手動アップロード』でクラウドへ反映してください。");
      } catch {
        alert("JSONの読み込みに失敗しました。");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="grid gap-6">
      {/* 追加フォーム */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">ToDoを追加</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：申請書を提出"
            className="rounded-xl border px-3 py-3"
            aria-label="タスク名"
          />
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="rounded-xl border px-3 py-3"
            aria-label="締め切り日"
          />
          <button onClick={add} className="rounded-xl bg-black px-5 py-3 text-white">
            追加
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          ※ 残り日数は「締め切り日のJST 23:59:59」までを基準に計算します（当日は残り0日）。
        </p>
      </section>

      {/* 一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">タスク一覧</h2>
          <div className="flex items-center gap-2">
            <button onClick={exportJson} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
              エクスポート（JSON）
            </button>
            <label className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
              インポート
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e)=>importJson(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              onClick={clearCompleted}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              title="完了済みだけを一括削除"
            >
              完了を一括削除
            </button>
          </div>
        </div>

        {tasksSorted.length === 0 ? (
          <p className="text-sm text-gray-500">まだタスクがありません。</p>
        ) : (
          <ul className="space-y-2">
            {tasksSorted.map((t) => {
              const left = daysLeftJST(t.deadline);
              return (
                <li key={t.id} className="rounded-xl border p-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!t.doneAt}
                        onChange={() => toggleDone(t.id)}
                        className="h-4 w-4"
                        aria-label="完了"
                      />
                      <span className={`font-medium break-words ${t.doneAt ? "line-through text-gray-500" : ""}`}>
                        {t.title}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(left)}`}>
                        {left < 0 ? `期限超過 ${Math.abs(left)}日` : left === 0 ? "今日" : `残り ${left}日`}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      期限: <span className="tabular-nums">{t.deadline}</span>
                      {t.doneAt && (
                        <span className="ml-2">
                          完了: {new Intl.DateTimeFormat("ja-JP", {
                            timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
                            hour: "2-digit", minute: "2-digit", hour12: false,
                          }).format(new Date(t.doneAt))}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 justify-start sm:justify-end">
                    {t.doneAt ? (
                      <button onClick={() => remove(t.id)} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                        削除
                      </button>
                    ) : (
                      <button onClick={() => toggleDone(t.id)} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                        完了にする
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
