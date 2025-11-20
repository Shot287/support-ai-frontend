// src/features/nudge/techniques/reflection-note.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type Store = {
  // key: "YYYY-MM-DD"
  notes: Record<string, string>;
  version: 1;
};

const LOCAL_KEY = "reflection_note_v1";
const DOC_KEY = "reflection_note_v1";

// 手動同期の共通チャネル（ホームと同じ定義）
const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

function createDefaultStore(): Store {
  return {
    notes: {},
    version: 1,
  };
}

function loadLocal(): Store {
  try {
    if (typeof window === "undefined") return createDefaultStore();
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createDefaultStore();
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      notes: parsed.notes ?? {},
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

function getToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatJapaneseDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  const weekdayJa = ["日", "月", "火", "水", "木", "金", "土"];
  const w = weekdayJa[dt.getDay()];
  return `${Number(y)}年${Number(m)}月${Number(d)}日（${w}）`;
}

export default function ReflectionNote() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  const [selectedDate, setSelectedDate] = useState<string>(() => getToday());

  // 端末ローカルへは即時保存（サーバ反映はホームの手動同期ボタンのみ）
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // 手動同期の合図を購読（PULL / PUSH / LOCAL_DOC_APPLIED / storage）
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
          setStore(JSON.parse(ev.newValue));
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

  // 過去に書いた日付を一覧にする（新しい日付が上）
  const datesWithNotes = useMemo(() => {
    const keys = Object.keys(store.notes);
    keys.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    return keys;
  }, [store.notes]);

  const currentText = store.notes[selectedDate] ?? "";

  const handleChangeDate = (value: string) => {
    if (!value) return;
    setSelectedDate(value);
  };

  const handleChangeNote = (value: string) => {
    const dateKey = selectedDate || getToday();
    setStore((s) => ({
      ...s,
      notes: {
        ...s.notes,
        [dateKey]: value,
      },
    }));
  };

  const clearToday = () => {
    const dateKey = selectedDate;
    if (!dateKey) return;
    if (!store.notes[dateKey]) return;
    if (!confirm("この日の反省ノートを空にします。よろしいですか？")) return;
    setStore((s) => {
      const next = { ...s.notes };
      delete next[dateKey];
      return { ...s, notes: next };
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* 左側：日付選択 & 一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">日付を選ぶ</h2>

        <div className="mb-4 space-y-2">
          <label className="block text-xs text-gray-600 mb-1">
            カレンダーから日付を選択
          </label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => handleChangeDate(e.target.value)}
            className="w-full rounded-xl border px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500">
            選択した日付ごとに、1枚の反省ノートが保存されます。
          </p>
        </div>

        <div className="border-t pt-3 mt-3">
          <h3 className="text-sm font-semibold mb-2">これまでの反省ノート</h3>
          {datesWithNotes.length === 0 ? (
            <p className="text-xs text-gray-500">
              まだ保存された反省ノートはありません。
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto text-sm space-y-1">
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
      </section>

      {/* 右側：反省ノート本体 */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[240px]">
        <div className="flex flex-wrap items-baseline gap-2 mb-3">
          <h2 className="font-semibold">
            {selectedDate
              ? `${formatJapaneseDate(selectedDate)} の反省ノート`
              : "反省ノート"}
          </h2>
          {currentText && (
            <button
              type="button"
              onClick={clearToday}
              className="ml-auto rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              この日のノートを削除
            </button>
          )}
        </div>

        <textarea
          value={currentText}
          onChange={(e) => handleChangeNote(e.target.value)}
          rows={12}
          className="w-full rounded-xl border px-3 py-2 text-sm leading-relaxed"
        />
      </section>
    </div>
  );
}
