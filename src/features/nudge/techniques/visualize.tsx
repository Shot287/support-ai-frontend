// src/features/nudge/techniques/visualize.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* ========== 型 ========== */
type ID = string;
type Exam = {
  id: ID;
  title: string;
  date: string;   // YYYY-MM-DD（JST）
  note?: string;
  createdAt: number;
};
type Store = { exams: Exam[]; version: 1 };

/* ========== 定数/ユーティリティ ========== */
const KEY = "visualize_v1";
const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
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
  const y = p.find(x => x.type === "year")?.value ?? "1970";
  const m = p.find(x => x.type === "month")?.value ?? "01";
  const d = p.find(x => x.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

// 指定日の JST 23:59:59 を UTC ms に
function jstEndOfDayMs(yyyyMmDd: string): number {
  return Date.parse(`${yyyyMmDd}T23:59:59+09:00`);
}
// JST 現在時刻（UTC ms）
function nowMs(): number {
  return Date.now();
}

function load(): Store {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return { exams: [], version: 1 };
    const parsed = JSON.parse(raw) as Store;
    return parsed?.version ? parsed : { exams: [], version: 1 };
  } catch {
    return { exams: [], version: 1 };
  }
}
function save(s: Store) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s));
}

function daysLeftJST(targetYmd: string): number {
  // 残り日数 = ceil((JST当日末尾 - now) / 1日)
  const ms = jstEndOfDayMs(targetYmd) - nowMs();
  return Math.ceil(ms / 86400000);
}

function badgeColor(days: number) {
  if (days < 0) return "bg-red-600 text-white";
  if (days === 0) return "bg-orange-500 text-white";
  if (days <= 7) return "bg-yellow-300 text-gray-900";
  return "bg-gray-200 text-gray-900";
}

/* ========== 本体 ========== */
export default function Visualize() {
  const [store, setStore] = useState<Store>(() => load());

  // 入力
  const [title, setTitle] = useState("");
  const [date, setDate]   = useState<string>(() => todayJstStr());
  const [note, setNote]   = useState("");

  // 編集
  const [editing, setEditing] = useState<ID | null>(null);
  const [tmpTitle, setTmpTitle] = useState("");
  const [tmpDate, setTmpDate]   = useState("");
  const [tmpNote, setTmpNote]   = useState("");

  useEffect(() => save(store), [store]);

  const exams = useMemo(
    () => store.exams.slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt),
    [store.exams]
  );

  const add = () => {
    const t = title.trim();
    const d = date.trim();
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      alert("試験名と日付（YYYY-MM-DD）を入力してください。");
      return;
    }
    const item: Exam = { id: uid(), title: t, date: d, note: note.trim() || undefined, createdAt: Date.now() };
    setStore(s => ({ ...s, exams: [...s.exams, item] }));
    setTitle(""); setNote("");
  };

  const startEdit = (id: ID) => {
    const x = store.exams.find(e => e.id === id);
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
    setStore(s => ({
      ...s,
      exams: s.exams.map(e => e.id === editing ? { ...e, title: t, date: d, note: tmpNote.trim() || undefined } : e),
    }));
    setEditing(null);
  };
  const remove = (id: ID) => {
    setStore(s => ({ ...s, exams: s.exams.filter(e => e.id !== id) }));
  };

  const today = todayJstStr();

  return (
    <div className="grid gap-6">
      {/* 追加フォーム */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">試験を追加</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex gap-2">
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="例: TOEIC L&R 本番"
              className="w-full rounded-xl border px-3 py-3"
              aria-label="試験名"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="rounded-xl border px-3 py-3"
              aria-label="試験日"
            />
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="メモ（任意）"
              className="flex-1 rounded-xl border px-3 py-3"
            />
            <button onClick={add} className="rounded-xl bg-black px-5 py-3 text-white">追加</button>
          </div>
          <p className="text-xs text-gray-500 sm:col-span-2">
            ※ 残り日数は「試験日のJST 23:59:59」までを基準に計算します（当日は残り0日）。
          </p>
        </div>
      </section>

      {/* ランキング／一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">試験一覧</h2>
          <div className="text-sm text-gray-600">今日: {today}</div>
        </div>

        <ul className="space-y-2">
          {exams.map(x => {
            const left = daysLeftJST(x.date);
            const isEditing = editing === x.id;
            const badge = (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeColor(left)}`}>
                {left < 0 ? `経過 ${Math.abs(left)}日` : left === 0 ? "今日" : `残り ${left}日`}
              </span>
            );

            return (
              <li key={x.id} className="rounded-xl border p-3">
                {!isEditing ? (
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{x.title}</span>
                        {badge}
                      </div>
                      <div className="text-sm text-gray-600">
                        試験日: <span className="tabular-nums">{x.date}</span>
                        {x.note ? <span className="ml-2 text-gray-500">📝 {x.note}</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => startEdit(x.id)} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">編集</button>
                      <button onClick={() => remove(x.id)} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">削除</button>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={tmpTitle}
                        onChange={e => setTmpTitle(e.target.value)}
                        className="rounded-lg border px-3 py-2 text-sm"
                        placeholder="試験名"
                      />
                      <input
                        type="date"
                        value={tmpDate}
                        onChange={e => setTmpDate(e.target.value)}
                        className="rounded-lg border px-3 py-2 text-sm"
                      />
                      <input
                        value={tmpNote}
                        onChange={e => setTmpNote(e.target.value)}
                        className="min-w-[160px] flex-1 rounded-lg border px-3 py-2 text-sm"
                        placeholder="メモ（任意）"
                      />
                      {badge}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={commitEdit} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">保存</button>
                      <button onClick={() => setEditing(null)} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">取消</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {exams.length === 0 && (
            <li className="text-sm text-gray-500">まだ試験が登録されていません。</li>
          )}
        </ul>

        {/* 一括操作 */}
        {exams.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (!confirm("すべての試験を削除します。よろしいですか？")) return;
                setStore({ exams: [], version: 1 });
              }}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              全削除
            </button>
            <button
              onClick={() => {
                setStore(s => ({ ...s, exams: s.exams.slice().sort((a,b)=> a.date.localeCompare(b.date) ) }));
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
