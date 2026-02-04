// src/features/nudge/techniques/todo.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

/* ========= 型 ========= */
type ID = string;

type Task = {
  id: ID;
  title: string;
  deadline: string; // YYYY-MM-DD (JST基準)
  createdAt: number; // ローカル専用（クラウドには載せない）
  doneAt?: number; // 完了時刻(ms)。未完了は undefined
};

type Store = { tasks: Task[]; version: 1 };

/** クラウドへ保存する最小形（createdAt は送らない） */
type RemoteTask = Omit<Task, "createdAt">;
type RemoteStore = { tasks: RemoteTask[]; version: 1 };

/* ========= 定数 / ユーティリティ ========= */
const LOCAL_KEY = "todo_v1";
const DOC_KEY = "todo_v1";

// 手動同期チャンネル（標準）
const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
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
  const y = p.find((x) => x.type === "year")?.value ?? "1970";
  const m = p.find((x) => x.type === "month")?.value ?? "01";
  const d = p.find((x) => x.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

// “その日の JST 23:59:59.999” までの残り日数（当日=0、期限超過は負数）
function daysLeftJST(yyyyMmDd: string): number {
  const end = Date.parse(`${yyyyMmDd}T23:59:59.999+09:00`);
  const now = Date.now();
  const diffDays = (end - now) / 86400000;
  return Math.floor(diffDays);
}

function badgeClass(left: number): string {
  if (left < 0) return "bg-red-600 text-white";
  if (left === 0) return "bg-orange-500 text-white";
  if (left <= 7) return "bg-yellow-300 text-gray-900";
  return "bg-gray-200 text-gray-900";
}

/* ========= localStorage 永続化 ========= */
function migrateLocal(raw: any): Store {
  const base: Store = { tasks: [], version: 1 };

  if (!raw || typeof raw !== "object") return base;
  if (raw.version !== 1) return base;

  const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks : [];
  const now = Date.now();

  const tasks: Task[] = tasksRaw
    .map((t: any) => {
      if (!t || typeof t !== "object") return null;

      const id = typeof t.id === "string" ? t.id : null;
      const title = typeof t.title === "string" ? t.title : "";
      const deadline = typeof t.deadline === "string" ? t.deadline : todayJst();

      // createdAt が欠けている（クラウドから来る / 古いデータ）場合は補完
      const createdAt =
        typeof t.createdAt === "number" && Number.isFinite(t.createdAt) ? t.createdAt : now;

      const doneAt =
        typeof t.doneAt === "number" && Number.isFinite(t.doneAt) ? t.doneAt : undefined;

      if (!id) return null;

      return { id, title, deadline, createdAt, doneAt };
    })
    .filter(Boolean) as Task[];

  return { version: 1, tasks };
}

function loadLocal(): Store {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(LOCAL_KEY) : null;
    if (!raw) return { tasks: [], version: 1 };
    return migrateLocal(JSON.parse(raw));
  } catch {
    return { tasks: [], version: 1 };
  }
}

function saveLocal(s: Store) {
  try {
    if (typeof window !== "undefined") localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
  } catch {}
}

/* ========= remote 変換 ========= */
function toRemote(s: Store): RemoteStore {
  return {
    version: 1,
    tasks: s.tasks.map(({ id, title, deadline, doneAt }) => ({
      id,
      title,
      deadline,
      doneAt,
    })),
  };
}

/* ========= 本体 ========= */
export default function TodoTechnique() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // ローカルへは即時保存（サーバ保存はしない）
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

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
      return (B.doneAt ?? 0) - (A.doneAt ?? 0);
    });
    return a;
  }, [store.tasks]);

  /* ========= 手動同期：購読（PULL / PUSH / LOCAL_DOC_APPLIED / storage） ========= */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<RemoteStore>(DOC_KEY);
        if (remote && remote.version === 1 && Array.isArray(remote.tasks)) {
          // クラウド→ローカル：createdAt は補完（ローカル専用）
          const now = Date.now();
          const next: Store = {
            version: 1,
            tasks: remote.tasks
              .map((t) => {
                const id = typeof t.id === "string" ? t.id : null;
                if (!id) return null;
                return {
                  id,
                  title: String(t.title ?? ""),
                  deadline: String(t.deadline ?? todayJst()),
                  createdAt: now,
                  doneAt: typeof t.doneAt === "number" ? t.doneAt : undefined,
                } as Task;
              })
              .filter(Boolean) as Task[],
          };
          setStore(next);
          saveLocal(next);
        }
      } catch (e) {
        console.warn("[todo] manual PULL failed:", e);
      }
    };

    const doPush = async () => {
      try {
        // ローカル→クラウド：createdAt は送らない
        await saveUserDoc<RemoteStore>(DOC_KEY, toRemote(storeRef.current));
      } catch (e) {
        console.warn("[todo] manual PUSH failed:", e);
      }
    };

    // BroadcastChannel
    let bc: BroadcastChannel | null = null;
    try {
      if ("BroadcastChannel" in window) {
        bc = new BroadcastChannel(SYNC_CHANNEL);
        bc.onmessage = (ev) => {
          const msg = ev?.data;
          if (!msg || typeof msg.type !== "string") return;
          const t = msg.type.toUpperCase();

          if (t.includes("PULL")) doPull();
          else if (t.includes("PUSH")) doPush();
          else if (t.includes("RESET")) {
            // since 未使用なので noop（直後にPULLが来る想定）
          } else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            // ホームが localStorage を直接書いた合図
            setStore(loadLocal());
          }
        };
      }
    } catch {}

    // 同タブ postMessage
    const onWinMsg = (ev: MessageEvent) => {
      const msg = ev?.data;
      if (!msg || typeof msg.type !== "string") return;
      const t = msg.type.toUpperCase();

      if (t.includes("PULL")) doPull();
      else if (t.includes("PUSH")) doPush();
      else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
        setStore(loadLocal());
      }
    };
    window.addEventListener("message", onWinMsg);

    // 他タブ storage（localKey 変更を拾う）
    const onStorage = (ev: StorageEvent) => {
      if (!ev.key) return;

      if (ev.key === LOCAL_KEY && ev.newValue) {
        try {
          setStore(migrateLocal(JSON.parse(ev.newValue)));
        } catch {}
      }

      if (ev.key === STORAGE_KEY_RESET_REQ) {
        // noop（直後にPULLが来る想定）
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      try {
        bc?.close();
      } catch {}
      window.removeEventListener("message", onWinMsg);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /* ========= CRUD（ローカル更新のみ） ========= */
  const add = () => {
    const t = title.trim();
    const d = deadline.trim();
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      alert("タスク名と締め切り日（YYYY-MM-DD）を入力してください。");
      return;
    }
    const item: Task = { id: uid(), title: t, deadline: d, createdAt: Date.now() };
    setStore((s) => ({ ...s, tasks: [item, ...s.tasks] }));
    setTitle("");
    inputRef.current?.focus();
  };

  const toggleDone = (id: ID) => {
    setStore((s) => ({
      ...s,
      tasks: s.tasks.map((x) =>
        x.id === id ? { ...x, doneAt: x.doneAt ? undefined : Date.now() } : x
      ),
    }));
  };

  const remove = (id: ID) => {
    setStore((s) => ({ ...s, tasks: s.tasks.filter((x) => x.id !== id) }));
  };

  const clearCompleted = () => {
    setStore((s) => ({ ...s, tasks: s.tasks.filter((x) => !x.doneAt) }));
  };

  // JSON 入出力（ローカルのみ。必要ならホームの☁で反映）
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], {
      type: "application/json;charset=utf-8",
    });
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
        const parsed = JSON.parse(String(reader.result));
        const next = migrateLocal(parsed);
        setStore(next);
        alert("インポートしました。必要ならホームの『☁ アップロード』でクラウドへ反映してください。");
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
            <button
              onClick={exportJson}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            >
              エクスポート（JSON）
            </button>
            <label className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
              インポート
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => importJson(e.target.files?.[0] ?? null)}
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
                <li
                  key={t.id}
                  className="rounded-xl border p-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!t.doneAt}
                        onChange={() => toggleDone(t.id)}
                        className="h-4 w-4"
                        aria-label="完了"
                      />
                      <span
                        className={`font-medium break-words ${
                          t.doneAt ? "line-through text-gray-500" : ""
                        }`}
                      >
                        {t.title}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(
                          left
                        )}`}
                      >
                        {left < 0
                          ? `期限超過 ${Math.abs(left)}日`
                          : left === 0
                          ? "今日"
                          : `残り ${left}日`}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      期限: <span className="tabular-nums">{t.deadline}</span>
                      {t.doneAt && (
                        <span className="ml-2">
                          完了:{" "}
                          {new Intl.DateTimeFormat("ja-JP", {
                            timeZone: "Asia/Tokyo",
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          }).format(new Date(t.doneAt))}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 justify-start sm:justify-end">
                    {t.doneAt ? (
                      <button
                        onClick={() => remove(t.id)}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        削除
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleDone(t.id)}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
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
