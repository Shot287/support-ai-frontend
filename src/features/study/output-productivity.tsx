// src/features/study/output-productivity.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

type Goal = {
  id: ID;
  name: string; // 例: レポート, 演習問題, ノート整理 など
  createdAt: number;
};

type DayNote = {
  date: string; // "2025-11-01" など
  note: string; // その日のアウトプット量メモ
};

// 月ごとに「アウトプット中タスクメモ（曜日ごと）」＋日別メモ
type WeekdayTasks = {
  mon: string;
  tue: string;
  wed: string;
  thu: string;
  fri: string;
  sat: string;
  sun: string;
};

type MonthRecord = {
  activeTasks: string; // 旧：1つだけのアウトプット中タスクメモ（互換保持用）
  weekdayTasks?: WeekdayTasks; // 新：曜日ごとのアウトプット中タスクメモ
  days: Record<string, DayNote>; // days[dateKey]
};

type Store = {
  goals: Goal[];
  // records[goalId][yearMonth] = MonthRecord
  records: Record<ID, Record<string, MonthRecord>>;
  version: 1;
};

const LOCAL_KEY = "output_productivity_v1";
const DOC_KEY = "output_productivity_v1";

// 手動同期の合図（ホーム画面と同じ）
const SYNC_CHANNEL = "support-ai-sync";
// ホームがフルリセット時に使うキー（ここでは since 未使用。購読のみ）
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
// ホームが localStorage に直接反映したことを知らせる合図
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

function createDefaultStore(): Store {
  return { goals: [], records: {}, version: 1 };
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
    // noop
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

const weekdayConfig: { key: keyof WeekdayTasks; label: string }[] = [
  { key: "mon", label: "月" },
  { key: "tue", label: "火" },
  { key: "wed", label: "水" },
  { key: "thu", label: "木" },
  { key: "fri", label: "金" },
  { key: "sat", label: "土" },
  { key: "sun", label: "日" },
];

export default function OutputProductivity() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  const [selectedGoalId, setSelectedGoalId] = useState<ID | null>(null);
  const [yearMonth, setYearMonth] = useState<string>(() => getTodayYearMonth());
  const [newGoalName, setNewGoalName] = useState("");

  // 端末ローカルへは即時保存（サーバ反映はホームの手動同期のみ）
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // 手動同期の合図を購読：PULL / PUSH / RESET + localStorage 変更検知
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<Store>(DOC_KEY);
        if (remote && remote.version === 1) {
          setStore(remote);
          saveLocal(remote);
        }
      } catch (e) {
        console.warn("[output-productivity] manual PULL failed:", e);
      }
    };

    const doPush = async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, storeRef.current);
      } catch (e) {
        console.warn("[output-productivity] manual PUSH failed:", e);
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
            // since 未使用。直後の PULL で最新化される想定。
          } else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            // ホームが直接 localStorage に書いた場合の合図
            setStore(loadLocal());
          }
        };
      }
    } catch {
      // noop
    }

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

    // 他タブ storage
    const onStorage = (ev: StorageEvent) => {
      if (!ev.key) return;
      // ホームがローカルへ反映したときは localStorage の中身が変わるので拾う
      if (ev.key === LOCAL_KEY && ev.newValue) {
        try {
          setStore(JSON.parse(ev.newValue));
        } catch {
          // noop
        }
      }
      if (ev.key === STORAGE_KEY_RESET_REQ) {
        // RESET 自体は何もしない（直後に PULL のはず）
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      if (bc) {
        try {
          bc.close();
        } catch {}
      }
      window.removeEventListener("message", onWinMsg);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // ゴールが存在していて、まだ何も選択していなければ先頭を自動選択
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

  // --- アウトプット中タスク（曜日ごとのノート） ---

  // MonthRecord を安全に取得（なければデフォルト生成）
  const getMonthRecord = (s: Store, goalId: ID | null): MonthRecord | null => {
    if (!goalId) return null;
    const goalRecords = s.records[goalId];
    if (!goalRecords) return null;
    const mr = goalRecords[yearMonth];
    if (!mr) return null;
    return mr;
  };

  // 曜日ごとの初期値作成（旧 activeTasks があればそれをベースにする）
  const createInitialWeekdayTasks = (mr?: MonthRecord | null): WeekdayTasks => {
    const base =
      mr && typeof mr.activeTasks === "string" && mr.activeTasks.trim().length > 0
        ? mr.activeTasks
        : "";
    return {
      mon: base,
      tue: base,
      wed: base,
      thu: base,
      fri: base,
      sat: base,
      sun: base,
    };
  };

  // 曜日ごとのタスク取得
  const getWeekdayTask = (
    goalId: ID | null,
    weekdayKey: keyof WeekdayTasks
  ): string => {
    if (!goalId) return "";
    const mr = getMonthRecord(store, goalId);
    if (!mr) return "";
    if (mr.weekdayTasks) {
      return mr.weekdayTasks[weekdayKey] ?? "";
    }
    // 旧データしかない場合は activeTasks を全曜日共通の初期値として返す
    if (typeof mr.activeTasks === "string") {
      return mr.activeTasks;
    }
    return "";
  };

  // 曜日ごとのタスク更新
  const updateWeekdayTask = (
    goalId: ID | null,
    weekdayKey: keyof WeekdayTasks,
    text: string
  ) => {
    if (!goalId) return;
    setStore((s) => {
      const records = { ...s.records };
      const goalRecords = { ...(records[goalId] ?? {}) };
      const existingMr: MonthRecord =
        goalRecords[yearMonth] ?? {
          activeTasks: "",
          days: {},
        };

      const currentWeekdayTasks: WeekdayTasks =
        existingMr.weekdayTasks ?? createInitialWeekdayTasks(existingMr);

      const nextWeekdayTasks: WeekdayTasks = {
        ...currentWeekdayTasks,
        [weekdayKey]: text,
      };

      goalRecords[yearMonth] = {
        ...existingMr,
        // 旧 activeTasks はそのまま残しておく（互換用）
        weekdayTasks: nextWeekdayTasks,
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
      goalRecords[yearMonth] = { ...monthRec, days };
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
    if (selectedGoalId === id) setSelectedGoalId(null);
  };

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
            {/* 月の「アウトプット中タスク（曜日ごと）」メモ */}
            <div className="rounded-2xl border px-4 py-3 bg-gray-50">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">
                  アウトプット中タスク（曜日ごとのメモ）
                </h3>
                <span className="text-xs text-gray-500">{yearMonth}</span>
              </div>
              <p className="text-xs text-gray-500 mb-2">
                月～日のそれぞれについて、この曜日に走らせたいタスク・科目などを書いてください。
              </p>

              <div className="grid gap-2 md:grid-cols-2">
                {weekdayConfig.map(({ key, label }) => {
                  const value = getWeekdayTask(selectedGoal.id, key);
                  return (
                    <div key={key} className="rounded-xl border bg-white px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{label}曜日</span>
                      </div>
                      <textarea
                        value={value}
                        onChange={(e) =>
                          updateWeekdayTask(selectedGoal.id, key, e.target.value)
                        }
                        rows={2}
                        className="w-full rounded-lg border px-2 py-1 text-xs"
                      />
                    </div>
                  );
                })}
              </div>
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
