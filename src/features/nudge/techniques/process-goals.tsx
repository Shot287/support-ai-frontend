// src/features/nudge/process-goals.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

type Goal = {
  id: ID;
  name: string;       // 例: 勉強時間, 睡眠時間
  createdAt: number;
};

type DayNote = {
  date: string;       // "2025-11-01" など
  note: string;
};

type Store = {
  goals: Goal[];
  // records[goalId][yearMonth]["YYYY-MM-DD"] = DayNote
  records: Record<ID, Record<string, Record<string, DayNote>>>;
  version: 1;
};

const LOCAL_KEY = "process_goals_v1";
const DOC_KEY = "process_goals_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// デフォルト状態（初期ゴール: 勉強時間 / 睡眠時間）
function createDefaultStore(): Store {
  const now = Date.now();
  const g1: Goal = { id: uid(), name: "勉強時間", createdAt: now };
  const g2: Goal = { id: uid(), name: "睡眠時間", createdAt: now + 1 };
  return {
    goals: [g1, g2],
    records: {},
    version: 1,
  };
}

function loadLocal(): Store {
  try {
    if (typeof window === "undefined") return createDefaultStore();
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createDefaultStore();
    const parsed = JSON.parse(raw) as Store;
    // version 将来用
    return { ...parsed, version: 1 };
  } catch {
    return createDefaultStore();
  }
}

function saveLocal(store: Store) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
    }
  } catch {
    // 失敗しても無視
  }
}

function getTodayYearMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const weekdayJa = ["日", "月", "火", "水", "木", "金", "土"];

export default function ProcessGoals() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  const [selectedGoalId, setSelectedGoalId] = useState<ID | null>(null);
  const [yearMonth, setYearMonth] = useState<string>(() => getTodayYearMonth());
  const [newGoalName, setNewGoalName] = useState("");
  const [openDates, setOpenDates] = useState<Record<string, boolean>>({}); // 展開状態

  // store 変更 → ローカル + サーバ保存
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
    (async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, store);
      } catch (e) {
        console.warn("[process-goals] saveUserDoc failed:", e);
      }
    })();
  }, [store]);

  // 初回マウントでサーバから最新版を取得
  useEffect(() => {
    (async () => {
      try {
        const remote = await loadUserDoc<Store>(DOC_KEY);
        if (remote && remote.version === 1) {
          setStore(remote);
          saveLocal(remote);
        } else if (!remote) {
          // サーバが空ならローカル状態をアップロード
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        }
      } catch (e) {
        console.warn("[process-goals] loadUserDoc failed:", e);
      }
    })();
  }, []);

  // ゴールが存在していて、まだ何も選択されていなければ先頭を自動選択
  useEffect(() => {
    if (!selectedGoalId && store.goals.length > 0) {
      setSelectedGoalId(store.goals[0].id);
    }
  }, [store.goals, selectedGoalId]);

  const selectedGoal = useMemo(
    () => store.goals.find((g) => g.id === selectedGoalId) ?? null,
    [store.goals, selectedGoalId]
  );

  // 指定年月の全日付リスト
  const daysList = useMemo(() => {
    const [yStr, mStr] = yearMonth.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    if (!y || !m) return [];
    const n = getDaysInMonth(y, m);
    const arr: { dateKey: string; day: number; weekday: string }[] = [];
    for (let d = 1; d <= n; d++) {
      const dateKey = `${yearMonth}-${String(d).padStart(2, "0")}`;
      const wd = weekdayJa[new Date(y, m - 1, d).getDay()];
      arr.push({ dateKey, day: d, weekday: wd });
    }
    return arr;
  }, [yearMonth]);

  // ある日付のノート取得
  const getNote = (goalId: ID | null, dateKey: string): string => {
    if (!goalId) return "";
    return (
      store.records[goalId]?.[yearMonth]?.[dateKey]?.note ?? ""
    );
  };

  // ノート更新
  const updateNote = (goalId: ID | null, dateKey: string, note: string) => {
    if (!goalId) return;
    setStore((s) => {
      const records = { ...s.records };
      const goalRecords = { ...(records[goalId] ?? {}) };
      const monthRecords = { ...(goalRecords[yearMonth] ?? {}) };

      monthRecords[dateKey] = { date: dateKey, note };
      goalRecords[yearMonth] = monthRecords;
      records[goalId] = goalRecords;

      return { ...s, records };
    });
  };

  // ゴール追加
  const addGoal = () => {
    const name = newGoalName.trim();
    if (!name) return;
    const now = Date.now();
    const g: Goal = { id: uid(), name, createdAt: now };
    setStore((s) => ({ ...s, goals: [...s.goals, g] }));
    setNewGoalName("");
    setSelectedGoalId(g.id);
  };

  // ゴール削除（記録も一緒に削除）
  const removeGoal = (id: ID) => {
    if (!confirm("この項目と、その記録をすべて削除します。よろしいですか？")) return;
    setStore((s) => {
      const goals = s.goals.filter((g) => g.id !== id);
      const records = { ...s.records };
      delete records[id];

      return { ...s, goals, records };
    });
    if (selectedGoalId === id) {
      setSelectedGoalId(null);
    }
  };

  // 展開状態の切り替え
  const toggleOpen = (dateKey: string) => {
    setOpenDates((prev) => ({ ...prev, [dateKey]: !prev[dateKey] }));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* 左側：項目（プロセス目標）リスト */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">プロセスの目標（項目）</h2>

        <div className="space-y-2 mb-4">
          {store.goals.length === 0 ? (
            <p className="text-sm text-gray-500">まだ項目がありません。</p>
          ) : (
            <ul className="space-y-1">
              {store.goals.map((g) => (
                <li key={g.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedGoalId(g.id)}
                    className={
                      "flex-1 rounded-xl border px-3 py-2 text-left text-sm " +
                      (selectedGoalId === g.id
                        ? "bg-black text-white"
                        : "bg-white hover:bg-gray-50")
                    }
                  >
                    {g.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeGoal(g.id)}
                    className="rounded-lg border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t pt-3 mt-3">
          <h3 className="text-sm font-semibold mb-2">項目を追加</h3>
          <div className="flex gap-2">
            <input
              value={newGoalName}
              onChange={(e) => setNewGoalName(e.target.value)}
              placeholder="例：勉強時間 / 睡眠時間 / 筋トレ など"
              className="flex-1 rounded-xl border px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={addGoal}
              className="rounded-xl bg-black px-3 py-2 text-sm text-white"
            >
              追加
            </button>
          </div>
        </div>
      </section>

      {/* 右側：1ヶ月分の記録 */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[200px]">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <h2 className="font-semibold">
            {selectedGoal ? `「${selectedGoal.name}」の1ヶ月記録` : "項目を選択してください"}
          </h2>

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-gray-600">月を選択:</span>
            <input
              type="month"
              value={yearMonth}
              onChange={(e) => setYearMonth(e.target.value)}
              className="rounded-xl border px-3 py-2 text-sm"
            />
          </div>
        </div>

        {!selectedGoal ? (
          <p className="text-sm text-gray-500">
            左のリストからプロセスの目標（項目）を選択してください。
          </p>
        ) : (
          <div className="space-y-2">
            {daysList.map(({ dateKey, day, weekday }) => {
              const isOpen = !!openDates[dateKey];
              const note = getNote(selectedGoal.id, dateKey);

              return (
                <div
                  key={dateKey}
                  className="rounded-xl border px-3 py-2 text-sm bg-white"
                >
                  <button
                    type="button"
                    onClick={() => toggleOpen(dateKey)}
                    className="flex w-full items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium">
                        {day}日（{weekday}）
                      </span>
                      {note && !isOpen && (
                        <span className="text-xs text-gray-500 truncate max-w-[200px]">
                          {note}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">
                      {isOpen ? "閉じる" : "展開"}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="mt-2">
                      <textarea
                        value={note}
                        onChange={(e) =>
                          updateNote(selectedGoal.id, dateKey, e.target.value)
                        }
                        rows={2}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        placeholder="この日の記録（例：勉強3時間、集中度、寝た時間 など）"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
