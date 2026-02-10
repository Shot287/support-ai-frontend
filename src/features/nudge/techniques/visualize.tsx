// src/features/nudge/techniques/visualize.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

/* ========== 型 ========== */
type ID = string;
type Exam = {
  id: ID;
  title: string;
  date: string; // YYYY-MM-DD（JST）
  note?: string;
  createdAt: number;
};
type Store = { exams: Exam[]; version: 1 };

/* ========== 定数/ユーティリティ ========== */
const LOCAL_KEY = "visualize_v1";
const DOC_KEY = "visualize_v1";

const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req"; // since未使用なら購読のみ
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// JST で today(YYYY-MM-DD)
function todayJstStr(): string {
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

/** YYYY-MM-DD の JST 00:00:00 を UTC ms に */
function jstStartOfDayMs(yyyyMmDd: string): number {
  // 例: 2026-02-10T00:00:00+09:00
  return Date.parse(`${yyyyMmDd}T00:00:00+09:00`);
}

function createDefaultStore(): Store {
  return { exams: [], version: 1 };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object";
}

function normalizeStore(raw: unknown): Store {
  if (!isRecord(raw) || raw.version !== 1) return createDefaultStore();

  const examsRaw = Array.isArray(raw.exams) ? raw.exams : [];

  const exams: Exam[] = examsRaw
    .filter((x: unknown): x is Record<string, unknown> => isRecord(x))
    .map((x): Exam => {
      const id = typeof x.id === "string" && x.id ? x.id : uid();
      const title = typeof x.title === "string" ? x.title : "";
      const date = typeof x.date === "string" ? x.date : todayJstStr();
      const note =
        typeof x.note === "string" && x.note.trim() ? x.note : undefined;
      const createdAt =
        typeof x.createdAt === "number" ? x.createdAt : Date.now();

      return { id, title, date, note, createdAt };
    })
    .filter(
      (e): e is Exam =>
        e.title.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.date)
    );

  return { exams, version: 1 };
}

function loadLocal(): Store {
  try {
    const raw =
      typeof window !== "undefined" ? localStorage.getItem(LOCAL_KEY) : null;
    if (!raw) return createDefaultStore();
    return normalizeStore(JSON.parse(raw));
  } catch {
    return createDefaultStore();
  }
}

function saveLocal(s: Store) {
  if (typeof window !== "undefined") {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
  }
}

/**
 * 残り日数（JST日付差分）
 * - target が今日なら 0（=「今日」）
 * - target が明日なら 1（=「残り1日」）
 * - target が昨日なら -1（=「経過1日」）
 */
function daysLeftJST(targetYmd: string): number {
  const todayYmd = todayJstStr();
  const today0 = jstStartOfDayMs(todayYmd);
  const target0 = jstStartOfDayMs(targetYmd);
  // ここは常に「日付差」なので整数になる想定
  return Math.round((target0 - today0) / 86400000);
}

function badgeColor(days: number) {
  if (days < 0) return "bg-red-600 text-white";
  if (days === 0) return "bg-orange-500 text-white";
  if (days <= 7) return "bg-yellow-300 text-gray-900";
  return "bg-gray-200 text-gray-900";
}

/* ========== 本体 ========== */
// 画面の見出し表示は「デイリーメトリクス」に変更（ルート/キーは維持）
export default function DailyMetrics() {
  const initialRef = useRef<Store | null>(null);
  if (initialRef.current === null) initialRef.current = loadLocal();

  const [store, setStore] = useState<Store>(() => initialRef.current!);
  const storeRef = useRef(store);

  // 入力
  const [title, setTitle] = useState("");
  const [date, setDate] = useState<string>(() => todayJstStr());
  const [note, setNote] = useState("");

  // 編集
  const [editing, setEditing] = useState<ID | null>(null);
  const [tmpTitle, setTmpTitle] = useState("");
  const [tmpDate, setTmpDate] = useState("");
  const [tmpNote, setTmpNote] = useState("");

  // ★ ローカルへは即時保存（サーバー保存しない）
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // ★ 手動同期の合図を購読（PULL / PUSH / LOCAL_DOC_APPLIED / storage）
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<Store>(DOC_KEY);
        if (remote) {
          const normalized = normalizeStore(remote);
          setStore(normalized);
          saveLocal(normalized);
          setEditing(null);
        }
      } catch (e: unknown) {
        console.warn("[daily-metrics] manual PULL failed:", e);
      }
    };

    const doPush = async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, storeRef.current);
      } catch (e: unknown) {
        console.warn("[daily-metrics] manual PUSH failed:", e);
      }
    };

    // BroadcastChannel
    let bc: BroadcastChannel | null = null;
    try {
      if ("BroadcastChannel" in window) {
        bc = new BroadcastChannel(SYNC_CHANNEL);
        bc.onmessage = (ev) => {
          const msg = (ev as MessageEvent)?.data;
          if (!msg || typeof msg.type !== "string") return;
          const t = msg.type.toUpperCase();

          if (t.includes("PULL")) doPull();
          else if (t.includes("PUSH")) doPush();
          else if (t.includes("RESET")) {
            // noop（直後に PULL が来る想定）
          } else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            const local = loadLocal(); // ホームが localStorage を直接書いた合図
            setStore(local);
            setEditing(null);
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
        const local = loadLocal();
        setStore(local);
        setEditing(null);
      }
    };
    window.addEventListener("message", onWinMsg);

    // 他タブ storage
    const onStorage = (ev: StorageEvent) => {
      if (!ev.key) return;

      if (ev.key === LOCAL_KEY && ev.newValue) {
        try {
          const next = normalizeStore(JSON.parse(ev.newValue));
          setStore(next);
          setEditing(null);
        } catch {}
      }

      if (ev.key === STORAGE_KEY_RESET_REQ) {
        // noop
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

  const exams = useMemo(
    () =>
      store.exams
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt),
    [store.exams]
  );

  const add = () => {
    const t = title.trim();
    const d = date.trim();
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      alert("タイトルと日付（YYYY-MM-DD）を入力してください。");
      return;
    }
    const item: Exam = {
      id: uid(),
      title: t,
      date: d,
      note: note.trim() || undefined,
      createdAt: Date.now(),
    };
    setStore((s) => ({ ...s, exams: [...s.exams, item] }));
    setTitle("");
    setNote("");
  };

  const startEdit = (id: ID) => {
    const x = store.exams.find((e) => e.id === id);
    if (!x) return;
    setEditing(id);
    setTmpTitle(x.title);
    setTmpDate(x.date);
    setTmpNote(x.note ?? "");
  };

  const commitEdit = () => {
    if (!editing) return;
    const t = tmpTitle.trim();
    const d = tmpDate.trim();
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      alert("編集内容を確認してください。");
      return;
    }
    setStore((s) => ({
      ...s,
      exams: s.exams.map((e) =>
        e.id === editing
          ? { ...e, title: t, date: d, note: tmpNote.trim() || undefined }
          : e
      ),
    }));
    setEditing(null);
  };

  const remove = (id: ID) => {
    setStore((s) => ({ ...s, exams: s.exams.filter((e) => e.id !== id) }));
  };

  const today = todayJstStr();

  return (
    <div className="grid gap-6">
      {/* 追加フォーム */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">デイリーメトリクスを追加</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex gap-2">
            <input
              value={title}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
              placeholder="例: TOEIC L&R 本番"
              className="w-full rounded-xl border px-3 py-3"
              aria-label="タイトル"
            />
          </div>

          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDate(e.target.value)}
              className="rounded-xl border px-3 py-3"
              aria-label="日付"
            />
            <input
              value={note}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
              placeholder="メモ（任意）"
              className="flex-1 rounded-xl border px-3 py-3"
            />
            <button onClick={add} className="rounded-xl bg-black px-5 py-3 text-white">
              追加
            </button>
          </div>

          <p className="text-xs text-gray-500 sm:col-span-2">
            ※ 残り日数は「JSTの日付差（00:00基準）」で計算します（当日は「今日」）。
          </p>
        </div>
      </section>

      {/* 一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">デイリーメトリクス一覧</h2>
          <div className="text-sm text-gray-600">今日: {today}</div>
        </div>

        <ul className="space-y-2">
          {exams.map((x) => {
            const left = daysLeftJST(x.date);
            const isEditingNow = editing === x.id;
            const badge = (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeColor(
                  left
                )}`}
              >
                {left < 0 ? `経過 ${Math.abs(left)}日` : left === 0 ? "今日" : `残り ${left}日`}
              </span>
            );

            return (
              <li key={x.id} className="rounded-xl border p-3">
                {!isEditingNow ? (
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{x.title}</span>
                        {badge}
                      </div>
                      <div className="text-sm text-gray-600">
                        日付: <span className="tabular-nums">{x.date}</span>
                        {x.note ? <span className="ml-2 text-gray-500">📝 {x.note}</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => startEdit(x.id)}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => remove(x.id)}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={tmpTitle}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setTmpTitle(e.target.value)}
                        className="rounded-lg border px-3 py-2 text-sm"
                        placeholder="タイトル"
                      />
                      <input
                        type="date"
                        value={tmpDate}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setTmpDate(e.target.value)}
                        className="rounded-lg border px-3 py-2 text-sm"
                      />
                      <input
                        value={tmpNote}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setTmpNote(e.target.value)}
                        className="min-w-[160px] flex-1 rounded-lg border px-3 py-2 text-sm"
                        placeholder="メモ（任意）"
                      />
                      {badge}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={commitEdit}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {exams.length === 0 && <li className="text-sm text-gray-500">まだ登録がありません。</li>}
        </ul>

        {exams.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (!confirm("すべて削除します。よろしいですか？")) return;
                setStore({ exams: [], version: 1 });
                setEditing(null);
              }}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              全削除
            </button>
            <button
              onClick={() => {
                setStore((s) => ({
                  ...s,
                  exams: s.exams.slice().sort((a, b) => a.date.localeCompare(b.date)),
                }));
              }}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              日付順に整列
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
