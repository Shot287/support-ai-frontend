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

type Store = {
  // key: "YYYY-MM-DD" -> itemId -> text
  notes: Record<string, Record<ID, string>>;
  items: Item[];
  version: 2;
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
  // JS の Date は溢れを許すのでガード
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

function createDefaultStore(): Store {
  const defaultItems: Item[] = [
    { id: "overall", name: "全体" },
    { id: "plan", name: "計画" },
    { id: "execution", name: "実行" },
    { id: "environment", name: "環境" },
    { id: "mindset", name: "メンタル" },
  ];
  return {
    notes: {},
    items: defaultItems,
    version: 2,
  };
}

function migrateToV2(v1: StoreV1): Store {
  const s = createDefaultStore();
  const nextNotes: Store["notes"] = {};
  for (const [dateKey, text] of Object.entries(v1.notes ?? {})) {
    if (!text) continue;
    nextNotes[dateKey] = { overall: text };
  }
  return { ...s, notes: nextNotes, version: 2 };
}

function loadLocal(): Store {
  try {
    if (typeof window === "undefined") return createDefaultStore();
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createDefaultStore();

    const parsed = JSON.parse(raw) as Partial<Store> | Partial<StoreV1>;

    // v2
    if ((parsed as any)?.version === 2) {
      const p = parsed as Partial<Store>;
      const items =
        Array.isArray(p.items) && p.items.length > 0
          ? p.items
              .filter((x) => x && typeof x.id === "string" && typeof x.name === "string")
              .map((x) => ({ id: x.id, name: x.name }))
          : createDefaultStore().items;

      const notes = (p.notes ?? {}) as Store["notes"];
      return {
        notes: notes ?? {},
        items,
        version: 2,
      };
    }

    // v1 -> v2
    if ((parsed as any)?.version === 1 || (parsed as any)?.notes) {
      const v1 = parsed as StoreV1;
      return migrateToV2(v1);
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

export default function ReflectionNote() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  const [selectedDate, setSelectedDate] = useState<string>(() => getToday());
  const [selectedItemId, setSelectedItemId] = useState<ID>(() => "overall");

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

  // items の中に selectedItemId がなければ補正
  useEffect(() => {
    if (store.items.some((x) => x.id === selectedItemId)) return;
    setSelectedItemId(store.items[0]?.id ?? "overall");
  }, [store.items, selectedItemId]);

  // 手動同期の合図を購読（PULL / PUSH / LOCAL_DOC_APPLIED / storage）
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<any>(DOC_KEY);
        if (!remote) return;

        // v2
        if (remote.version === 2) {
          setStore(remote as Store);
          saveLocal(remote as Store);
          return;
        }

        // v1 -> v2
        if (remote.version === 1) {
          const migrated = migrateToV2(remote as StoreV1);
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
      // ホームが localStorage(localKey) を書き換えたとき
      if (ev.key === LOCAL_KEY && ev.newValue) {
        try {
          const parsed = JSON.parse(ev.newValue);
          // 互換のため loadLocal で整形
          saveLocal(loadLocal());
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

  const currentText =
    (store.notes[selectedDate]?.[selectedItemId] ?? "").toString();

  const handleChangeDate = (value: string) => {
    if (!value) return;
    setSelectedDate(value);
  };

  const handleChangeNote = (value: string) => {
    const dateKey = selectedDate || getToday();
    const itemId = selectedItemId;

    setStore((s) => {
      const prevByItem = s.notes[dateKey] ?? {};
      const nextByItem = { ...prevByItem, [itemId]: value };
      const nextNotes = { ...s.notes, [dateKey]: nextByItem };
      const cleaned = cleanupEmptyDate(nextNotes, dateKey);
      return { ...s, notes: cleaned };
    });
  };

  const clearCurrentItemNote = () => {
    const dateKey = selectedDate;
    const itemId = selectedItemId;
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

      const cleaned = cleanupEmptyDate(nextNotes, dateKey);
      return { ...s, notes: cleaned };
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

  // 項目管理（追加/削除）
  const addItem = () => {
    const name = prompt("新しい項目名を入力してください");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    setStore((s) => {
      const id = uid();
      const nextItems = [...s.items, { id, name: trimmed }];
      return { ...s, items: nextItems };
    });
    // 追加直後に選択
    // setStore の後に state 変更しても問題ない
    setSelectedItemId((_) => {
      // 直後は id が必要なのでもう一度生成しない（上の uid を使ったいがため）
      // ここは安全側：次レンダーで補正される
      return selectedItemId;
    });
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
      ? `「${item.name}」を削除すると、過去のこの項目の反省文も見えなくなります（データも削除）。削除しますか？`
      : `「${item.name}」を削除しますか？`;

    if (!confirm(msg)) return;

    setStore((s) => {
      // items
      const nextItems = s.items.filter((x) => x.id !== id);

      // notes: remove itemId across all dates
      const nextNotes: Store["notes"] = {};
      for (const [dateKey, byItem] of Object.entries(s.notes)) {
        if (!byItem) continue;
        const nb = { ...byItem };
        delete nb[id];
        // 空なら date ごと消す
        const hasAny = Object.values(nb).some((t) => (t ?? "").trim().length > 0);
        if (hasAny) nextNotes[dateKey] = nb;
      }

      return { ...s, items: nextItems, notes: nextNotes };
    });

    if (selectedItemId === id) setSelectedItemId("overall");
  };

  // カレンダー（月表示）
  const calGrid = useMemo(() => {
    const first = startOfMonth(calYear, calMonth0);
    const firstWeekday = first.getDay(); // 0=Sun
    const dim = daysInMonth(calYear, calMonth0);

    // 6週×7日で固定
    const cells: Array<{
      dateKey: string | null;
      day: number | null;
    }> = [];

    // 先頭の空白
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ dateKey: null, day: null });
    }

    // 日付
    for (let d = 1; d <= dim; d++) {
      const dt = new Date(calYear, calMonth0, d);
      cells.push({ dateKey: toKey(dt), day: d });
    }

    // 末尾の空白を埋めて 42 にする
    while (cells.length < 42) {
      cells.push({ dateKey: null, day: null });
    }

    // 6行に分割
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

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* 左側：項目選択 & カレンダー & 日付一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="mb-4">
          <h2 className="font-semibold mb-2">項目を選ぶ</h2>

          <div className="flex items-center gap-2">
            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
            >
              {store.items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={addItem}
              className="shrink-0 rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
              title="項目を追加"
            >
              追加
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => renameItem(selectedItemId)}
              className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              名前変更
            </button>
            <button
              type="button"
              onClick={() => deleteItem(selectedItemId)}
              className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              削除
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            項目を選んで、その項目の反省文を日付ごとに保存できます。
          </p>
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
                  if (!cell.dateKey || !cell.day) {
                    return <div key={j} className="h-9 rounded-lg" />;
                  }

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
                      <span className={isToday && !isSelected ? "font-semibold" : ""}>
                        {cell.day}
                      </span>

                      {/* ノートがある日を強調（小さいドット） */}
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

      {/* 右側：反省文 */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[240px]">
        <div className="flex flex-wrap items-baseline gap-2 mb-3">
          <h2 className="font-semibold">
            {selectedDate
              ? `${formatJapaneseDate(selectedDate)} / ${
                  store.items.find((x) => x.id === selectedItemId)?.name ?? "項目"
                } の反省`
              : "反省ノート"}
          </h2>

          <div className="ml-auto flex flex-wrap gap-2">
            {currentText && (
              <button
                type="button"
                onClick={clearCurrentItemNote}
                className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                この項目の反省文を削除
              </button>
            )}
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

        <textarea
          value={currentText}
          onChange={(e) => handleChangeNote(e.target.value)}
          rows={12}
          className="w-full rounded-xl border px-3 py-2 text-sm leading-relaxed"
          placeholder="ここに反省文を書いてください（自動でローカル保存されます）"
        />

        <p className="text-xs text-gray-500 mt-2">
          端末ローカルには即時保存、サーバ反映はホームの📥/☁（手動同期）で行われます。
        </p>
      </section>
    </div>
  );
}
