// src/features/nudge/techniques/work-log.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiPost } from "../../../lib/api";

/** ========== 型 ========== */
type ID = string;
type Group = { id: ID; name: string; color?: string; createdAt: number };
type Card = { id: ID; groupId: ID; name: string; color?: string; createdAt: number };
type Session = { id: ID; cardId: ID; start: number; end?: number; note?: string };

type StoreShape = { groups: Group[]; cards: Card[]; sessions: Session[]; version: 1 };

const STORE_KEY = "worklog_v1";

/** ========== ユーティリティ ========== */
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function loadStore(): StoreShape {
  if (typeof window === "undefined")
    return { groups: [], cards: [], sessions: [], version: 1 };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { groups: [], cards: [], sessions: [], version: 1 };
    const parsed = JSON.parse(raw) as StoreShape;
    if (!parsed.version) throw new Error("invalid store");
    return parsed;
  } catch {
    return { groups: [], cards: [], sessions: [], version: 1 };
  }
}

function saveStore(s: StoreShape) {
  if (typeof window !== "undefined")
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

function minutesBetween(a: number, b: number) {
  return Math.max(0, Math.round((b - a) / 60000));
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** ========== メイン ========== */
export default function WorkLog() {
  const [store, setStore] = useState<StoreShape>(() => loadStore());
  const [groupName, setGroupName] = useState("");
  const [cardName, setCardName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<ID | "">("");
  const [selectedCardId, setSelectedCardId] = useState<ID | "">("");
  const [note, setNote] = useState("");

  const running = useMemo(() => store.sessions.find((s) => !s.end), [store.sessions]);

  useEffect(() => saveStore(store), [store]);

  /** ========== 追加/削除 ========== */
  const addGroup = () => {
    const name = groupName.trim();
    if (!name) return;
    const g: Group = {
      id: uid(),
      name,
      color: pickColor(name),
      createdAt: Date.now(),
    };
    setStore((s) => ({ ...s, groups: [...s.groups, g] }));
    setGroupName("");
    if (!selectedGroupId) setSelectedGroupId(g.id);
  };

  const addCard = () => {
    if (!selectedGroupId) return;
    const name = cardName.trim();
    if (!name) return;
    const c: Card = {
      id: uid(),
      groupId: selectedGroupId,
      name,
      color: pickColor(name),
      createdAt: Date.now(),
    };
    setStore((s) => ({ ...s, cards: [...s.cards, c] }));
    setCardName("");
    if (!selectedCardId) setSelectedCardId(c.id);
  };

  /** ========== 計測開始/終了 ========== */
  const startWork = async () => {
    if (!selectedCardId || running) return;

    const newS: Session = { id: uid(), cardId: selectedCardId, start: Date.now() };
    setStore((s) => ({ ...s, sessions: [...s.sessions, newS] }));

    try {
      await apiPost<{ ok: true }>("/nudge/work-log/sessions/start", {
        card_id: selectedCardId,
      });
    } catch (e) {
      console.error("start API failed", e);
      setStore((s) => ({
        ...s,
        sessions: s.sessions.filter((x) => x.id !== newS.id),
      }));
      alert("開始リクエストが拒否されました。x-token または CORS を確認してください。");
    }
  };

  const stopWork = async () => {
    if (!running) return;

    const stoppedAt = Date.now();
    const noteText = note.trim();
    setStore((s) => ({
      ...s,
      sessions: s.sessions.map((x) =>
        x.id === running.id ? { ...x, end: stoppedAt, note: noteText || x.note } : x
      ),
    }));
    setNote("");

    try {
      await apiPost<{ ok: true }>("/nudge/work-log/sessions/stop", noteText ? { note: noteText } : undefined);
    } catch (e) {
      console.error("stop API failed", e);
      alert("終了リクエストが拒否されました。x-token または CORS を確認してください。");
      setStore((s) => ({
        ...s,
        sessions: s.sessions.map((x) =>
          x.id === running.id ? { ...x, end: undefined } : x
        ),
      }));
    }
  };

  /** ========== 表示 ========== */
  const runningElapsed = running ? minutesBetween(running.start, Date.now()) : 0;
  const cardMap = Object.fromEntries(store.cards.map((c) => [c.id, c]));

  return (
    <div className="rounded-2xl border p-6 shadow-sm grid gap-6">
      {/* === グループ === */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border p-4">
          <h2 className="font-semibold mb-3">カードグループ</h2>
          <div className="flex gap-2">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="例: TOEIC"
              className="w-full rounded-xl border px-3 py-2"
            />
            <button
              onClick={addGroup}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              追加
            </button>
          </div>
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value as ID | "")}
            className="mt-3 w-full rounded-xl border px-3 py-2"
          >
            <option value="">すべて</option>
            {store.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        {/* === カード === */}
        <div className="rounded-xl border p-4">
          <h2 className="font-semibold mb-3">カード</h2>
          <div className="flex gap-2">
            <input
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              placeholder="例: 単語 / 文法"
              className="w-full rounded-xl border px-3 py-2"
            />
            <button
              onClick={addCard}
              disabled={!selectedGroupId}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50 disabled:opacity-40"
            >
              追加
            </button>
          </div>
          <select
            value={selectedCardId}
            onChange={(e) => setSelectedCardId(e.target.value as ID | "")}
            className="mt-3 w-full rounded-xl border px-3 py-2"
          >
            <option value="">カードを選択</option>
            {store.cards
              .filter((c) => !selectedGroupId || c.groupId === selectedGroupId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
      </section>

      {/* === 計測 === */}
      <section className="rounded-xl border p-4">
        <h2 className="font-semibold mb-3">計測</h2>
        {!running ? (
          <button
            onClick={startWork}
            disabled={!selectedCardId}
            className="rounded-xl bg-black px-5 py-2 text-white disabled:bg-gray-300"
          >
            作業開始
          </button>
        ) : (
          <>
            <button
              onClick={stopWork}
              className="rounded-xl bg-gray-800 px-5 py-2 text-white"
            >
              作業終了
            </button>
            <div className="text-sm text-gray-700">
              計測中: <b>{cardMap[running.cardId]?.name ?? "?"}</b>（{fmtHM(runningElapsed)}）
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="メモ（任意）"
              className="rounded-xl border px-3 py-2"
            />
          </>
        )}
      </section>
    </div>
  );
}

/** ========== 見た目ユーティリティ ========== */
function pickColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 80% 45%)`;
}
function fmtHM(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}時間${String(m).padStart(2, "0")}分` : `${m}分`;
}
