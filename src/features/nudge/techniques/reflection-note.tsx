// src/features/nudge/techniques/reflection-note.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

type Item = {
  id: ID;
  name: string;
};

type StoreV1 = {
  // key: "YYYY-MM-DD"
  notes: Record<string, string>;
  version: 1;
};

type StoreV2 = {
  // key: "YYYY-MM-DD" -> itemId -> text
  notes: Record<string, Record<ID, string>>;
  items: Item[];
  version: 2;
};

type Store = {
  // key: "YYYY-MM-DD" -> itemId -> text
  notes: Record<string, Record<ID, string>>;
  // その日に「書く（表示する）」項目（複数選択）
  // ※未選択でも notes に内容が残ることはある（＝過去のメモを残しておける）
  dayItems: Record<string, ID[]>;
  items: Item[];
  version: 3;
};

const LOCAL_KEY = "reflection_note_v1";
const DOC_KEY = "reflection_note_v1";

// 手動同期の共通チャネル（ホームと同じ定義）
const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

function uid(): string {
  // 依存なしで十分ユニーク
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

function fromKey(dateStr: string): Date | null {
  const [y, m, d] = dateStr.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d)
    return null;
  return dt;
}

function addDaysKey(dateKey: string, deltaDays: number): string {
  const dt = fromKey(dateKey);
  if (!dt) return dateKey;
  dt.setDate(dt.getDate() + deltaDays);
  return toKey(dt);
}

function getToday(): string {
  return toKey(new Date());
}

function formatJapaneseDate(dateStr: string): string {
  const dt = fromKey(dateStr);
  if (!dt) return dateStr;
  const weekdayJa = ["日", "月", "火", "水", "木", "金", "土"];
  const w = weekdayJa[dt.getDay()];
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日（${w}）`;
}

function monthTitle(year: number, monthIndex0: number) {
  return `${year}年${monthIndex0 + 1}月`;
}

function startOfMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0, 1);
}

function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function uniqKeepOrder(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function normalizeDayItems(store: Pick<Store, "dayItems" | "notes">, dateKey: string): ID[] {
  const fromStore = store.dayItems?.[dateKey];
  if (Array.isArray(fromStore) && fromStore.length > 0) return uniqKeepOrder(fromStore);

  // dayItems が無い場合：その日の notes に存在する itemId を採用
  const byItem = store.notes?.[dateKey] ?? {};
  const keys = Object.keys(byItem).filter((k) => (byItem[k] ?? "").trim().length > 0);
  if (keys.length > 0) return uniqKeepOrder(keys);

  // それも無ければ「全体」
  return ["overall"];
}

function createDefaultStore(): Store {
  // 例：よく使う「ルーティン」「睡眠」も最初から入れる（ユーザーが追加しなくて済む）
  const defaultItems: Item[] = [
    { id: "overall", name: "全体" },
    { id: "routine", name: "ルーティン" },
    { id: "sleep", name: "睡眠" },
    { id: "plan", name: "計画" },
    { id: "execution", name: "実行" },
    { id: "environment", name: "環境" },
    { id: "mindset", name: "メンタル" },
  ];
  return {
    notes: {},
    dayItems: {},
    items: defaultItems,
    version: 3,
  };
}

function migrateToV2(v1: StoreV1): StoreV2 {
  // v1 の 1テキスト/日 を overall に入れる
  const items: Item[] = [
    { id: "overall", name: "全体" },
    { id: "routine", name: "ルーティン" },
    { id: "sleep", name: "睡眠" },
    { id: "plan", name: "計画" },
    { id: "execution", name: "実行" },
    { id: "environment", name: "環境" },
    { id: "mindset", name: "メンタル" },
  ];
  const nextNotes: StoreV2["notes"] = {};
  for (const [dateKey, text] of Object.entries(v1.notes ?? {})) {
    if (!text) continue;
    nextNotes[dateKey] = { overall: text };
  }
  return { notes: nextNotes, items, version: 2 };
}

function migrateToV3(from: StoreV1 | StoreV2): Store {
  const base = createDefaultStore();

  // v1 -> v2 -> v3
  if ((from as any).version === 1) {
    const v2 = migrateToV2(from as StoreV1);
    const dayItems: Record<string, ID[]> = {};
    for (const [dateKey, byItem] of Object.entries(v2.notes ?? {})) {
      const ids = Object.keys(byItem ?? {});
      dayItems[dateKey] = ids.length > 0 ? uniqKeepOrder(ids) : ["overall"];
    }
    return { ...base, notes: v2.notes ?? {}, items: v2.items ?? base.items, dayItems, version: 3 };
  }

  // v2 -> v3
  const v2 = from as StoreV2;
  const dayItems: Record<string, ID[]> = {};
  for (const [dateKey, byItem] of Object.entries(v2.notes ?? {})) {
    const ids = Object.keys(byItem ?? {}).filter((id) => ((byItem as any)[id] ?? "").trim().length > 0);
    dayItems[dateKey] = ids.length > 0 ? uniqKeepOrder(ids) : ["overall"];
  }
  return { ...base, notes: v2.notes ?? {}, items: v2.items ?? base.items, dayItems, version: 3 };
}

function loadLocal(): Store {
  try {
    if (typeof window === "undefined") return createDefaultStore();
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createDefaultStore();

    const parsed = JSON.parse(raw) as Partial<Store> | Partial<StoreV2> | Partial<StoreV1>;

    // v3
    if ((parsed as any)?.version === 3) {
      const p = parsed as Partial<Store>;

      const items =
        Array.isArray(p.items) && p.items.length > 0
          ? p.items
              .filter((x) => x && typeof x.id === "string" && typeof x.name === "string")
              .map((x) => ({ id: x.id, name: x.name }))
          : createDefaultStore().items;

      const notes = ((p.notes ?? {}) as Store["notes"]) ?? {};
      const dayItems = ((p.dayItems ?? {}) as Store["dayItems"]) ?? {};

      // 最低限 overall が存在するように補正
      const hasOverall = items.some((x) => x.id === "overall");
      const fixedItems = hasOverall ? items : [{ id: "overall", name: "全体" }, ...items];

      return { notes, dayItems, items: fixedItems, version: 3 };
    }

    // v2 / v1 -> v3
    if ((parsed as any)?.version === 2) {
      return migrateToV3(parsed as StoreV2);
    }
    if ((parsed as any)?.version === 1 || (parsed as any)?.notes) {
      // v1 っぽい or 古い
      const v1 = parsed as StoreV1;
      // v1 かもしれないが、v2 の形で入ってる可能性もあるので安全に判定
      if (typeof (v1 as any).notes === "object" && !Array.isArray((v1 as any).items)) {
        // v1
        if (typeof (v1 as any).notes?.[Object.keys((v1 as any).notes ?? {})[0]] === "string") {
          return migrateToV3(v1);
        }
      }
      // それでも不明ならデフォルト
      return createDefaultStore();
    }

    return createDefaultStore();
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

function hasAnyNoteForDate(notes: Store["notes"], dateKey: string): boolean {
  const byItem = notes[dateKey];
  if (!byItem) return false;
  return Object.values(byItem).some((t) => (t ?? "").trim().length > 0);
}

function cleanupEmptyDate(notes: Store["notes"], dateKey: string): Store["notes"] {
  const byItem = notes[dateKey];
  if (!byItem) return notes;
  const kept: Record<ID, string> = {};
  for (const [itemId, t] of Object.entries(byItem)) {
    const tt = (t ?? "").trimEnd();
    if (tt.trim().length > 0) kept[itemId] = tt;
  }
  const next = { ...notes };
  if (Object.keys(kept).length === 0) {
    delete next[dateKey];
  } else {
    next[dateKey] = kept;
  }
  return next;
}

function ensureSelectedIdsAreValid(selectedIds: ID[], items: Item[]): ID[] {
  const set = new Set(items.map((x) => x.id));
  const filtered = selectedIds.filter((id) => set.has(id));
  if (filtered.length > 0) return uniqKeepOrder(filtered);
  return ["overall"].filter((id) => set.has(id)) || [items[0]?.id ?? "overall"];
}

export default function ReflectionNote() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  const [selectedDate, setSelectedDate] = useState<string>(() => getToday());

  // 複数選択（その日に書く項目）
  const [selectedItemIds, setSelectedItemIds] = useState<ID[]>(() => ["overall"]);

  // カレンダー表示用（年月）
  const [calYear, setCalYear] = useState<number>(() => {
    const dt = fromKey(getToday()) ?? new Date();
    return dt.getFullYear();
  });
  const [calMonth0, setCalMonth0] = useState<number>(() => {
    const dt = fromKey(getToday()) ?? new Date();
    return dt.getMonth();
  });

  // 端末ローカルへは即時保存（サーバ反映はホームの手動同期ボタンのみ）
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // selectedDate が変わったらカレンダー月も追従
  useEffect(() => {
    const dt = fromKey(selectedDate);
    if (!dt) return;
    setCalYear(dt.getFullYear());
    setCalMonth0(dt.getMonth());
  }, [selectedDate]);

  // 日付が変わったら、その日の複数選択を store.dayItems から復元
  useEffect(() => {
    const ids = normalizeDayItems(store, selectedDate);
    const fixed = ensureSelectedIdsAreValid(ids, store.items);
    setSelectedItemIds(fixed);
  }, [selectedDate, store.items]); // store.dayItems 変更は setStore 内で更新される前提

  // items が変わったら、選択中IDsを補正（消えた項目を外す）
  useEffect(() => {
    setSelectedItemIds((prev) => ensureSelectedIdsAreValid(prev, store.items));
  }, [store.items]);

  // 手動同期の合図を購読（PULL / PUSH / LOCAL_DOC_APPLIED / storage）
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<any>(DOC_KEY);
        if (!remote) return;

        if (remote.version === 3) {
          setStore(remote as Store);
          saveLocal(remote as Store);
          return;
        }

        if (remote.version === 2) {
          const migrated = migrateToV3(remote as StoreV2);
          setStore(migrated);
          saveLocal(migrated);
          return;
        }

        if (remote.version === 1) {
          const migrated = migrateToV3(remote as StoreV1);
          setStore(migrated);
          saveLocal(migrated);
          return;
        }
      } catch (e) {
        console.warn("[reflection-note] manual PULL failed:", e);
      }
    };

    const doPush = async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, storeRef.current);
      } catch (e) {
        console.warn("[reflection-note] manual PUSH failed:", e);
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
            // since 未使用。直後に PULL が来る想定。
          } else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            // ホームが localStorage に直接反映した合図
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
      if (ev.key === LOCAL_KEY && ev.newValue) {
        try {
          setStore(loadLocal());
        } catch {
          // noop
        }
      }
      if (ev.key === STORAGE_KEY_RESET_REQ) {
        // RESET 自体は noop（直後に PULL が来る前提）
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      if (bc) {
        try {
          bc.close();
        } catch {
          // noop
        }
      }
      window.removeEventListener("message", onWinMsg);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // 反省文がある日（新しい日付が上）
  const datesWithNotes = useMemo(() => {
    const keys = Object.keys(store.notes);
    const filtered = keys.filter((k) => hasAnyNoteForDate(store.notes, k));
    filtered.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    return filtered;
  }, [store.notes]);

  const datesWithNotesSet = useMemo(() => new Set(datesWithNotes), [datesWithNotes]);

  const handleChangeDate = (value: string) => {
    if (!value) return;
    setSelectedDate(value);
  };

  // その日で「選択された項目」を保存（表示対象の切り替え）
  const setDayItems = (dateKey: string, ids: ID[]) => {
    const fixed = ensureSelectedIdsAreValid(uniqKeepOrder(ids), store.items);
    setSelectedItemIds(fixed);
    setStore((s) => ({
      ...s,
      dayItems: {
        ...s.dayItems,
        [dateKey]: fixed,
      },
    }));
  };

  const toggleItemForDay = (id: ID) => {
    const dateKey = selectedDate || getToday();
    setDayItems(
      dateKey,
      selectedItemIds.includes(id)
        ? selectedItemIds.filter((x) => x !== id)
        : [...selectedItemIds, id]
    );
  };

  const handleChangeNote = (itemId: ID, value: string) => {
    const dateKey = selectedDate || getToday();

    setStore((s) => {
      const prevByItem = s.notes[dateKey] ?? {};
      const nextByItem = { ...prevByItem, [itemId]: value };
      const nextNotes = { ...s.notes, [dateKey]: nextByItem };
      const cleanedNotes = cleanupEmptyDate(nextNotes, dateKey);

      // 書いたらその項目は「その日の選択」に入れておく（自然な挙動）
      const currentDay = s.dayItems[dateKey] ?? normalizeDayItems(s, dateKey);
      const nextDay = uniqKeepOrder([...currentDay, itemId]);

      return {
        ...s,
        notes: cleanedNotes,
        dayItems: {
          ...s.dayItems,
          [dateKey]: nextDay,
        },
      };
    });

    // UI側も即追従
    if (!selectedItemIds.includes(itemId)) {
      setSelectedItemIds((prev) => uniqKeepOrder([...prev, itemId]));
    }
  };

  const clearItemNote = (itemId: ID) => {
    const dateKey = selectedDate;
    const existing = store.notes[dateKey]?.[itemId] ?? "";
    if (!existing) return;
    if (!confirm("この項目の反省文を空にします。よろしいですか？")) return;

    setStore((s) => {
      const byItem = s.notes[dateKey] ?? {};
      const nextByItem = { ...byItem };
      delete nextByItem[itemId];

      const nextNotes = { ...s.notes };
      if (Object.keys(nextByItem).length === 0) delete nextNotes[dateKey];
      else nextNotes[dateKey] = nextByItem;

      const cleanedNotes = cleanupEmptyDate(nextNotes, dateKey);

      // dayItems は残す（＝「今日はこの項目を見る」は維持）
      return { ...s, notes: cleanedNotes };
    });
  };

  const clearAllNotesOfDay = () => {
    const dateKey = selectedDate;
    if (!dateKey) return;
    if (!store.notes[dateKey]) return;
    if (!confirm("この日の反省文（全項目）を削除します。よろしいですか？")) return;

    setStore((s) => {
      const next = { ...s.notes };
      delete next[dateKey];
      return { ...s, notes: next };
    });
  };

  // 項目管理（追加/名前変更/削除）
  const addItem = () => {
    const name = prompt("新しい項目名を入力してください（例：学習 / バイト / 体調 など）");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const newId = uid();
    setStore((s) => ({
      ...s,
      items: [...s.items, { id: newId, name: trimmed }],
    }));

    // 追加したら今日の選択に入れておく（便利）
    const dateKey = selectedDate || getToday();
    setDayItems(dateKey, [...selectedItemIds, newId]);
  };

  const renameItem = (id: ID) => {
    const current = store.items.find((x) => x.id === id);
    if (!current) return;
    const name = prompt("項目名を変更してください", current.name);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    setStore((s) => ({
      ...s,
      items: s.items.map((x) => (x.id === id ? { ...x, name: trimmed } : x)),
    }));
  };

  const deleteItem = (id: ID) => {
    if (id === "overall") {
      alert("「全体」は削除できません。");
      return;
    }
    const item = store.items.find((x) => x.id === id);
    if (!item) return;

    const usedSomewhere = Object.values(store.notes).some((byItem) => byItem?.[id]);
    const msg = usedSomewhere
      ? `「${item.name}」を削除すると、過去のこの項目の反省文も削除されます。削除しますか？`
      : `「${item.name}」を削除しますか？`;

    if (!confirm(msg)) return;

    setStore((s) => {
      const nextItems = s.items.filter((x) => x.id !== id);

      // notes: remove itemId across all dates
      const nextNotes: Store["notes"] = {};
      for (const [dateKey, byItem] of Object.entries(s.notes)) {
        if (!byItem) continue;
        const nb = { ...byItem };
        delete nb[id];
        const hasAny = Object.values(nb).some((t) => (t ?? "").trim().length > 0);
        if (hasAny) nextNotes[dateKey] = nb;
      }

      // dayItems: remove itemId across all dates
      const nextDayItems: Store["dayItems"] = {};
      for (const [dateKey, ids] of Object.entries(s.dayItems ?? {})) {
        if (!Array.isArray(ids)) continue;
        const filtered = ids.filter((x) => x !== id);
        if (filtered.length > 0) nextDayItems[dateKey] = filtered;
      }

      return { ...s, items: nextItems, notes: nextNotes, dayItems: nextDayItems };
    });

    setSelectedItemIds((prev) => prev.filter((x) => x !== id));
  };

  // カレンダー（月表示）
  const calGrid = useMemo(() => {
    const first = startOfMonth(calYear, calMonth0);
    const firstWeekday = first.getDay(); // 0=Sun
    const dim = daysInMonth(calYear, calMonth0);

    const cells: Array<{ dateKey: string | null; day: number | null }> = [];

    for (let i = 0; i < firstWeekday; i++) cells.push({ dateKey: null, day: null });

    for (let d = 1; d <= dim; d++) {
      const dt = new Date(calYear, calMonth0, d);
      cells.push({ dateKey: toKey(dt), day: d });
    }

    while (cells.length < 42) cells.push({ dateKey: null, day: null });

    const rows: typeof cells[] = [];
    for (let i = 0; i < 42; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [calYear, calMonth0]);

  const gotoPrevMonth = () => {
    setCalMonth0((m) => {
      const next = m - 1;
      if (next >= 0) return next;
      setCalYear((y) => y - 1);
      return 11;
    });
  };

  const gotoNextMonth = () => {
    setCalMonth0((m) => {
      const next = m + 1;
      if (next <= 11) return next;
      setCalYear((y) => y + 1);
      return 0;
    });
  };

  const jumpToday = () => setSelectedDate(getToday());
  const jumpPrevWeekSameDay = () => setSelectedDate((d) => addDaysKey(d, -7));
  const jumpNextWeekSameDay = () => setSelectedDate((d) => addDaysKey(d, +7));

  const selectedItems = useMemo(() => {
    const map = new Map(store.items.map((x) => [x.id, x]));
    return selectedItemIds.map((id) => map.get(id)).filter(Boolean) as Item[];
  }, [selectedItemIds, store.items]);

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* 左側：項目（複数選択） & カレンダー & 日付一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="font-semibold">項目を選ぶ（複数）</h2>
            <button
              type="button"
              onClick={addItem}
              className="ml-auto shrink-0 rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
              title="項目を追加"
            >
              追加
            </button>
          </div>

          <p className="text-xs text-gray-500 mb-2">
            例：同じ日に「ルーティン」と「睡眠」を両方チェックして反省できます（内容は日ごとに変えてOK）。
          </p>

          <div className="flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              onClick={() => setDayItems(selectedDate, store.items.map((x) => x.id))}
              className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              全て選択
            </button>
            <button
              type="button"
              onClick={() => setDayItems(selectedDate, ["overall"])}
              className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              最小（全体だけ）
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto rounded-xl border bg-white">
            <ul className="p-2 space-y-1">
              {store.items.map((it) => {
                const checked = selectedItemIds.includes(it.id);
                const hasText = (store.notes[selectedDate]?.[it.id] ?? "").trim().length > 0;
                return (
                  <li
                    key={it.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleItemForDay(it.id)}
                      className="h-4 w-4"
                    />
                    <button
                      type="button"
                      onClick={() => toggleItemForDay(it.id)}
                      className="text-left text-sm flex-1"
                      title={it.name}
                    >
                      {it.name}
                      {hasText && <span className="ml-2 text-[10px] text-gray-500">(内容あり)</span>}
                    </button>

                    <button
                      type="button"
                      onClick={() => renameItem(it.id)}
                      className="rounded-lg border px-2 py-1 text-[10px] text-gray-600 hover:bg-white"
                      title="名前変更"
                    >
                      変更
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteItem(it.id)}
                      className="rounded-lg border px-2 py-1 text-[10px] text-gray-600 hover:bg-white"
                      title="削除"
                    >
                      削除
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">カレンダー</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={gotoPrevMonth}
                className="rounded-xl border px-2 py-1 text-xs hover:bg-gray-50"
                aria-label="前の月"
              >
                ←
              </button>
              <div className="text-sm font-medium">{monthTitle(calYear, calMonth0)}</div>
              <button
                type="button"
                onClick={gotoNextMonth}
                className="rounded-xl border px-2 py-1 text-xs hover:bg-gray-50"
                aria-label="次の月"
              >
                →
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-xs mb-1">
            {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
              <div key={w} className="text-center text-gray-500">
                {w}
              </div>
            ))}
          </div>

          <div className="grid gap-1">
            {calGrid.map((row, i) => (
              <div key={i} className="grid grid-cols-7 gap-1">
                {row.map((cell, j) => {
                  if (!cell.dateKey || !cell.day) return <div key={j} className="h-9 rounded-lg" />;

                  const isSelected = cell.dateKey === selectedDate;
                  const isToday = cell.dateKey === getToday();
                  const hasNote = datesWithNotesSet.has(cell.dateKey);

                  return (
                    <button
                      key={j}
                      type="button"
                      onClick={() => handleChangeDate(cell.dateKey!)}
                      className={
                        "relative h-9 rounded-lg border text-center text-sm " +
                        (isSelected
                          ? "bg-black text-white border-black"
                          : "bg-white hover:bg-gray-50") +
                        (hasNote && !isSelected ? " ring-1 ring-black/20" : "")
                      }
                      title={formatJapaneseDate(cell.dateKey)}
                    >
                      <span className={isToday && !isSelected ? "font-semibold" : ""}>{cell.day}</span>
                      {hasNote && (
                        <span
                          className={
                            "absolute bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full " +
                            (isSelected ? "bg-white" : "bg-black/70")
                          }
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={jumpToday}
              className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              今日へ
            </button>
            <button
              type="button"
              onClick={jumpPrevWeekSameDay}
              className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              先週の同曜日
            </button>
            <button
              type="button"
              onClick={jumpNextWeekSameDay}
              className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              来週の同曜日
            </button>
          </div>

          {/* 互換のため date input も残す（必要なら手入力できる） */}
          <div className="mt-3 space-y-2">
            <label className="block text-xs text-gray-600">日付を直接指定</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => handleChangeDate(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
            />
          </div>

          <div className="border-t pt-3 mt-4">
            <h3 className="text-sm font-semibold mb-2">反省文がある日</h3>
            {datesWithNotes.length === 0 ? (
              <p className="text-xs text-gray-500">まだ保存された反省文はありません。</p>
            ) : (
              <ul className="max-h-56 overflow-y-auto text-sm space-y-1">
                {datesWithNotes.map((d) => (
                  <li key={d}>
                    <button
                      type="button"
                      onClick={() => setSelectedDate(d)}
                      className={
                        "w-full text-left rounded-xl px-3 py-1.5 " +
                        (d === selectedDate
                          ? "bg-black text-white text-xs"
                          : "bg-gray-50 hover:bg-gray-100 text-xs text-gray-700")
                      }
                    >
                      {formatJapaneseDate(d)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* 右側：反省文（選択項目ぶん複数表示） */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[240px]">
        <div className="flex flex-wrap items-baseline gap-2 mb-3">
          <h2 className="font-semibold">
            {selectedDate ? `${formatJapaneseDate(selectedDate)} の反省` : "反省ノート"}
          </h2>

          <div className="ml-auto flex flex-wrap gap-2">
            {store.notes[selectedDate] && (
              <button
                type="button"
                onClick={clearAllNotesOfDay}
                className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                この日の全反省文を削除
              </button>
            )}
          </div>
        </div>

        {selectedItems.length === 0 ? (
          <div className="rounded-xl border bg-gray-50 p-4">
            <p className="text-sm text-gray-700">項目が未選択です。</p>
            <button
              type="button"
              onClick={() => setDayItems(selectedDate, ["overall"])}
              className="mt-2 rounded-xl border px-3 py-2 text-xs hover:bg-white"
            >
              「全体」を選択する
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {selectedItems.map((it) => {
              const value = (store.notes[selectedDate]?.[it.id] ?? "").toString();
              return (
                <div key={it.id} className="rounded-2xl border p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-sm">{it.name}</h3>
                    {value.trim().length > 0 && <span className="text-[10px] text-gray-500">保存済み</span>}
                    {value.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() => clearItemNote(it.id)}
                        className="ml-auto rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        この項目を削除
                      </button>
                    )}
                  </div>

                  <textarea
                    value={value}
                    onChange={(e) => handleChangeNote(it.id, e.target.value)}
                    onKeyDownCapture={(e) => {
                      // ★修正：外側の Enter ショートカット等に潰されないようにする
                      // ここでは preventDefault しない（＝textarea の改行は生かす）
                      if (e.key === "Enter") {
                        e.stopPropagation();
                      }
                    }}
                    rows={6}
                    className="w-full rounded-xl border px-3 py-2 text-sm leading-relaxed"
                    placeholder={`「${it.name}」について書く`}
                  />
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-gray-500 mt-3">
          端末ローカルには即時保存、サーバ反映はホームの📥/☁（手動同期）で行われます。
        </p>
      </section>
    </div>
  );
}
