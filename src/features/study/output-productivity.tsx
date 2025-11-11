// src/features/study/output-productivity.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

type Goal = {
  id: ID;
  name: string;       // 例: レポート, 演習問題, ノート整理 など
  createdAt: number;
};

type DayNote = {
  date: string;       // "2025-11-01" など
  note: string;       // その日のアウトプット量メモ
};

// 月ごとに「アウトプット中タスクメモ」＋日別メモ
type MonthRecord = {
  activeTasks: string;                      // その月に走っているタスクの一覧
  days: Record<string, DayNote>;           // days[dateKey]
};

type Store = {
  goals: Goal[];
  // records[goalId][yearMonth] = MonthRecord
  records: Record<ID, Record<string, MonthRecord>>;
  version: 1;
};

const LOCAL_KEY = "output_productivity_v1";
const DOC_KEY = "output_productivity_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

function createDefaultStore(): Store {
  return {
    goals: [],
    records: {},
    version: 1,
  };
}

function loadLocal(): Store {
  try {
    if (typeof window === "undefined") return createDefaultStore();
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createDefaultStore();
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (!parsed || typeof parsed !== "object") return createDefaultStore();

    return {
      goals: parsed.goals ?? [],
      records: parsed.records ?? {},
      version: 1,
    };
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

export default function OutputProductivity() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  const [selectedGoalId, setSelectedGoalId] = useState<ID | null>(null);
  const [yearMonth, setYearMonth] = useState<string>(() => getTodayYearMonth());
  const [newGoalName, setNewGoalName] = useState("");

  // store 変更 → ローカル + サーバ保存
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
    (async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, store);
      } catch (e) {
        console.warn("[output-productivity] saveUserDoc failed:", e);
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
        } else {
          // 万一 version が違う形式だった場合も、ざっくり補正して使う
          const fallback: Store = {
            goals: (remote as any).goals ?? [],
            records: (remote as any).records ?? {},
            version: 1,
          };
          setStore(fallback);
          saveLocal(fallback);
          await saveUserDoc<Store>(DOC_KEY, fallback);
        }
      } catch (e) {
        console.warn("[output-productivity] loadUserDoc failed:", e);
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

  // 月の「アウトプット中タスク」取得
  const getActiveTasks = (goalId: ID | null): string => {
    if (!goalId) return "";
    return store.records[goalId]?.[yearMonth]?.activeTasks ?? "";
  };

  // 月の「アウトプット中タスク」更新
  const updateActiveTasks = (goalId: ID | null, text: string) => {
    if (!goalId) return;
    setStore((s) => {
      const records = { ...s.records };
      const goalRecords = { ...(records[goalId] ?? {}) };
      const monthRec: MonthRecord = goalRecords[yearMonth] ?? {
        activeTasks: "",
        days: {},
      };

      goalRecords[yearMonth] = {
        ...monthRec,
        activeTasks: text,
      };
      records[goalId] = goalRecords;

      return { ...s, records };
    });
  };

  // ある日付のノート取得
  const getNote = (goalId: ID | null, dateKey: string): string => {
    if (!goalId) return "";
    return store.records[goalId]?.[yearMonth]?.days?.[dateKey]?.note ?? "";
  };

  // ノート更新
  const updateNote = (goalId: ID | null, dateKey: string, note: string) => {
    if (!goalId) return;
    setStore((s) => {
      const records = { ...s.records };
      const goalRecords = { ...(records[goalId] ?? {}) };
      const monthRec: MonthRecord = goalRecords[yearMonth] ?? {
        activeTasks: "",
        days: {},
      };
      const days = { ...(monthRec.days ?? {}) };

      days[dateKey] = { date: dateKey, note };
      goalRecords[yearMonth] = {
        ...monthRec,
        days,
      };
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

  const currentActiveTasks = getActiveTasks(selectedGoal?.id ?? null);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* 左側：アウトプット対象（項目）リスト */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">アウトプット対象（項目）</h2>

        <div className="space-y-2 mb-4">
          {store.goals.length === 0 ? (
            <p className="text-sm text-gray-500">
              まだ項目がありません。「レポート」「演習問題」「ノート整理」などを追加してください。
            </p>
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
              placeholder="例：レポート / 演習問題 / ノート整理 など"
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
            {selectedGoal
              ? `「${selectedGoal.name}」のアウトプット生産量（1ヶ月）`
              : "項目を選択してください"}
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
            左のリストからアウトプット対象（項目）を選択してください。
          </p>
        ) : (
          <div className="space-y-4">
            {/* 月の「アウトプット中タスク」メモ（常に展開） */}
            <div className="rounded-2xl border px-4 py-3 bg-gray-50">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">アウトプット中タスク</h3>
                <span className="text-xs text-gray-500">{yearMonth}</span>
              </div>
              <textarea
                value={currentActiveTasks}
                onChange={(e) =>
                  updateActiveTasks(selectedGoal.id, e.target.value)
                }
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm bg-white"
                placeholder={`この月に同時進行しているタスクを書き出してください。\n例：\n・◯◯レポート（締切 11/20）\n・線形代数の演習ノート作成\n・過去問○年分の解き直し など`}
              />
            </div>

            {/* 日別ノート（常に展開状態） */}
            <div className="space-y-2">
              {daysList.map(({ dateKey, day, weekday }) => {
                const note = getNote(selectedGoal.id, dateKey);
                return (
                  <div
                    key={dateKey}
                    className="rounded-xl border px-3 py-2 text-sm bg-white"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-3">
                        <span className="font-medium">
                          {day}日（{weekday}）
                        </span>
                      </div>
                      <span className="text-xs text-gray-400">{dateKey}</span>
                    </div>
                    <textarea
                      value={note}
                      onChange={(e) =>
                        updateNote(selectedGoal.id, dateKey, e.target.value)
                      }
                      rows={2}
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      placeholder="この日のアウトプット生産量（例：レポート3ページ、演習20問、ノート2ページ、スライド5枚 など）"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
