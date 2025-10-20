// src/features/nudge/techniques/work-log.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";

/** ========== 型 ========== */
type ID = string;
type Group = { id: ID; name: string; color?: string; createdAt: number; serverId?: string };
type Card  = { id: ID; groupId: ID; name: string; color?: string; createdAt: number; serverId?: string };
type Session = {
  id: ID;
  cardId: ID;          // ローカルカードID
  start: number;       // epoch ms (UTC)
  end?: number;        // epoch ms (UTC), 計測中は undefined
  note?: string;
};

type StoreShape = {
  groups: Group[];
  cards: Card[];
  sessions: Session[];
  version: 1;
};

// サーバーAPIの戻り型
type ServerGroup = { id: string; name: string; color?: string; created_at?: string; user_id?: string };
type ServerCard  = { id: string; group_id: string; name: string; color?: string; created_at?: string; user_id?: string };

const STORE_KEY = "worklog_v1";

/** ========== ユーティリティ ========== */
const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function loadStore(): StoreShape {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(STORE_KEY) : null;
    if (!raw) return { groups: [], cards: [], sessions: [], version: 1 };
    const parsed = JSON.parse(raw) as StoreShape;
    if (!parsed.version) throw new Error("invalid store");
    return parsed;
  } catch {
    return { groups: [], cards: [], sessions: [], version: 1 };
  }
}
function saveStore(s: StoreShape) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }
}

function secondsBetween(a: number, b: number) {
  // 小刻みな跳ねを避けるため floor（進行中は 1 秒刻みで増える）
  return Math.max(0, Math.floor((b - a) / 1000));
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** エラーメッセージからHTTPステータス/詳細を推定（api.ts の両フォーマット対応） */
function parseApiError(e: unknown): { status?: number; detailText?: string } {
  const msg = e instanceof Error ? e.message : String(e);
  const num = msg.match(/\b(\d{3})\b/);
  const status = num ? Number(num[1]) : undefined;

  let detailText: string | undefined;
  const jsonTail = msg.match(/\{[\s\S]*\}\s*$/);
  if (jsonTail) {
    try {
      const j = JSON.parse(jsonTail[0]) as Record<string, unknown>;
      if ("detail" in j) {
        const d = j.detail as unknown;
        detailText = typeof d === "string" ? d : JSON.stringify(d);
      } else {
        detailText = jsonTail[0];
      }
    } catch {
      detailText = jsonTail[0];
    }
  }
  return { status, detailText };
}

/** ========== JSTユーティリティ ========== */
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
function jstDayStartMs(yyyyMmDd: string): number {
  return Date.parse(`${yyyyMmDd}T00:00:00+09:00`);
}
function fmtTimeJST(ts: number | Date) {
  const d = typeof ts === "number" ? new Date(ts) : ts;
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hh = p.find((x) => x.type === "hour")?.value ?? "00";
  const mm = p.find((x) => x.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}
function toInputJST(ts: number): string {
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));
  const y = p.find((x) => x.type === "year")?.value ?? "1970";
  const m = p.find((x) => x.type === "month")?.value ?? "01";
  const d = p.find((x) => x.type === "day")?.value ?? "01";
  const hh = p.find((x) => x.type === "hour")?.value ?? "00";
  const mm = p.find((x) => x.type === "minute")?.value ?? "00";
  return `${y}-${m}-${d}T${hh}:${mm}`;
}
function parseInputAsJST(input: string): number {
  return Date.parse(`${input}:00+09:00`);
}

/** ========== サーバ同期ヘルパ ========== */
async function ensureGroupOnServer(group: Group): Promise<string> {
  if (group.serverId) return group.serverId;
  await apiPost(`/nudge/work-log/groups`, { name: group.name, color: group.color });
  const serverGroups = await apiGet<ServerGroup[]>(`/nudge/work-log/groups`);
  const matched = serverGroups.filter(g => g?.name === group.name);
  const picked = matched.length > 0 ? matched[matched.length - 1] : undefined;
  const serverId = picked?.id;
  if (!serverId) throw new Error("サーバ側グループIDの特定に失敗しました");
  return serverId;
}
async function ensureCardOnServer(card: Card, parentGroup: Group): Promise<string> {
  if (card.serverId) return card.serverId;
  const groupServerId = await ensureGroupOnServer(parentGroup);
  await apiPost(`/nudge/work-log/cards`, {
    group_id: groupServerId,
    name: card.name,
    color: card.color,
  });
  const serverCards = await apiGet<ServerCard[]>(`/nudge/work-log/cards?group_id=${encodeURIComponent(groupServerId)}`);
  const found = serverCards.find(c => c?.name === card.name) ?? serverCards[serverCards.length - 1];
  const serverId = found?.id;
  if (!serverId) throw new Error("サーバ側カードIDの特定に失敗しました");
  return serverId;
}

/** ========== メイン ========== */
export default function WorkLog() {
  const [store, setStore] = useState<StoreShape>(() => loadStore());
  const [groupName, setGroupName] = useState("");
  const [cardName, setCardName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<ID | "">("");
  const [selectedCardId, setSelectedCardId] = useState<ID | "">("");

  // 既定日付は JST の今日
  const [dateStr, setDateStr] = useState<string>(() => todayJstStr());
  const [note, setNote] = useState("");

  // 計測中セッション（カードごとに最大1つ）
  const running = useMemo(() => store.sessions.find(s => !s.end), [store.sessions]);

  // 派生マップ
  const groupMap = useMemo(() => Object.fromEntries(store.groups.map(g => [g.id, g])), [store.groups]);
  const cardMap  = useMemo(() => Object.fromEntries(store.cards.map(c => [c.id, c])), [store.cards]);
  const cardsInSelectedGroup = useMemo(
    () => store.cards.filter(c => !selectedGroupId ? true : c.groupId === selectedGroupId),
    [store.cards, selectedGroupId]
  );

  // 日付の範囲（JST 0:00〜24:00）
  const currentDayStart = useMemo(() => jstDayStartMs(dateStr), [dateStr]);
  const currentDayEnd = currentDayStart + 24 * 60 * 60 * 1000 - 1;

  useEffect(() => saveStore(store), [store]);

  /** ========== 追加/削除 ========== */
  const addGroup = async () => {
    const name = groupName.trim();
    if (!name) return;
    const local: Group = { id: uid(), name, color: pickColor(name), createdAt: Date.now() };
    setStore(s => ({ ...s, groups: [...s.groups, local] }));
    setGroupName("");
    if (!selectedGroupId) setSelectedGroupId(local.id);
    try {
      const serverId = await ensureGroupOnServer(local);
      setStore(s => ({ ...s, groups: s.groups.map(g => g.id === local.id ? { ...g, serverId } : g) }));
    } catch (e) {
      console.error("group sync failed", e);
      alert("グループのサーバ登録に失敗しました。ネットワークや認証(x-token)をご確認ください。");
    }
  };

  const addCard = async () => {
    if (!selectedGroupId) return;
    const name = cardName.trim();
    if (!name) return;
    const local: Card = { id: uid(), groupId: selectedGroupId, name, color: pickColor(name), createdAt: Date.now() };
    setStore(s => ({ ...s, cards: [...s.cards, local] }));
    setCardName("");
    if (!selectedCardId) setSelectedCardId(local.id);
    try {
      const grp = groupMap[selectedGroupId as string];
      if (!grp) throw new Error("group not found");
      const serverId = await ensureCardOnServer(local, grp);
      setStore(s => ({ ...s, cards: s.cards.map(c => c.id === local.id ? { ...c, serverId } : c) }));
    } catch (e) {
      console.error("card sync failed", e);
      alert("カードのサーバ登録に失敗しました。ネットワークや認証(x-token)をご確認ください。");
    }
  };

  const deleteSession = (id: ID) => {
    setStore(s => ({ ...s, sessions: s.sessions.filter(x => x.id !== id) }));
  };

  /** ========== 計測（409自動解決つき） ========== */
  const startWork = async () => {
    if (!selectedCardId || running) return;
    const card = cardMap[selectedCardId as string];
    if (!card) return;

    // 先にUIを更新（楽観的）
    const optimistic: Session = { id: uid(), cardId: selectedCardId as ID, start: Date.now() };
    setStore(s => ({ ...s, sessions: [...s.sessions, optimistic] }));

    const rollback = () =>
      setStore(s => ({ ...s, sessions: s.sessions.filter(x => x.id !== optimistic.id) }));

    try {
      // serverId が未確定ならここで確定
      let serverCardId = card.serverId;
      if (!serverCardId) {
        const grp = groupMap[card.groupId];
        if (!grp) throw new Error("group not found for card");
        serverCardId = await ensureCardOnServer(card, grp);
        setStore(s => ({
          ...s,
          cards: s.cards.map(c => c.id === card.id ? { ...c, serverId: serverCardId! } : c),
        }));
      }

      await apiPost<{ ok: true }>(`/nudge/work-log/sessions/start`, { card_id: serverCardId });
    } catch (e) {
      const { status, detailText } = parseApiError(e);

      // 409 "already running" → stop→start を自動で実行
      if (status === 409 || (detailText && /already\s*running/i.test(detailText))) {
        try {
          // ★ 空ボディ {} を必ず送る（FastAPI 側で body 必須）
          await apiPost<{ ok: true }>(`/nudge/work-log/sessions/stop`, {});
          // 楽観追加はいったん取り消し
          rollback();

          // 再スタート
          const serverCardId = card.serverId ?? (await ensureCardOnServer(card, groupMap[card.groupId]!));
          await apiPost<{ ok: true }>(`/nudge/work-log/sessions/start`, { card_id: serverCardId });

          // 再度UI反映
          const re: Session = { id: uid(), cardId: selectedCardId as ID, start: Date.now() };
          setStore(s => ({ ...s, sessions: [...s.sessions, re] }));
          return;
        } catch (e2) {
          console.error("retry start after stop failed", e2);
          rollback();
          alert("開始処理（再試行）に失敗しました。ネットワークや認証(x-token)をご確認ください。");
          return;
        }
      }

      console.error("start API failed", e);
      rollback();
      alert("開始のサーバ登録に失敗しました。ネットワークや認証(x-token)を確認してください。");
    }
  };

  const stopWork = async () => {
    if (!running) return;

    // 先にUIを更新（楽観的）
    const stoppedAt = Date.now();
    const noteText = note.trim();
    setStore(s => ({
      ...s,
      sessions: s.sessions.map(x => x.id === running.id ? { ...x, end: stoppedAt, note: noteText || x.note } : x)
    }));
    setNote("");

    try {
      // ★ メモが空でも {} を送る（422対策）
      await apiPost<{ ok: true }>(`/nudge/work-log/sessions/stop`, noteText ? { note: noteText } : {});
    } catch (e) {
      console.error("stop API failed", e);
      // 失敗したらUIを元に戻す（計測中に戻す）
      setStore(s => ({
        ...s,
        sessions: s.sessions.map(x => x.id === running.id ? { ...x, end: undefined } : x)
      }));
      setNote(noteText); // 入力を戻す
      alert("終了のサーバ登録に失敗しました。ネットワークや認証(x-token)を確認してください。");
    }
  };

  /** ========== 編集（手動調整） ========== */
  const updateSessionTimes = (id: ID, startLocalJst: string, endLocalJst: string) => {
    const startTs = parseInputAsJST(startLocalJst);
    const endTs   = parseInputAsJST(endLocalJst);
    if (Number.isNaN(startTs) || Number.isNaN(endTs) || endTs <= startTs) return;
    setStore(s => ({
      ...s,
      sessions: s.sessions.map(x => x.id === id ? { ...x, start: startTs, end: endTs } : x),
    }));
  };

  /** ========== 当日セッション ========== */
  const sessionsToday = useMemo(() => {
    return store.sessions
      .filter(s => {
        const a = s.start;
        const b = s.end ?? Date.now();
        return !(b < currentDayStart || a > currentDayEnd);
      })
      .sort((A, B) => (A.start - B.start));
  }, [store.sessions, currentDayStart, currentDayEnd]);

  /** ========== 集計（秒） ========== */
  const totalSecondsToday = useMemo(() => {
    return sessionsToday.reduce((acc, s) => {
      const a = clamp(s.start, currentDayStart, currentDayEnd);
      const b = clamp((s.end ?? Date.now()), currentDayStart, currentDayEnd);
      return acc + secondsBetween(a, b);
    }, 0);
  }, [sessionsToday, currentDayStart, currentDayEnd]);

  /** ========== タイマーUIの経過表示（秒） ========== */
  const [, forceTick] = useState(0);
  const tickRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    tickRef.current = window.setInterval(() => forceTick(x => x + 1), 1000);
    return () => { if (tickRef.current) window.clearInterval(tickRef.current); };
  }, [running]);

  const runningElapsedSec = running ? secondsBetween(running.start, Date.now()) : 0;

  /** ========== レンダリング ========== */
  return (
    <div className="rounded-2xl border p-4 sm:p-6 shadow-sm grid gap-6">
      {/* 上段：グループ＆カード作成（モバイル1カラム → smで2カラム） */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border p-4">
          <h2 className="font-semibold mb-3">カードグループ</h2>
          <div className="flex gap-2">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="例: TOEIC"
              className="w-full rounded-xl border px-3 py-3"
              aria-label="グループ名"
            />
            <button onClick={addGroup} className="rounded-xl border px-4 py-3 hover:bg-gray-50">追加</button>
          </div>

          <div className="mt-3">
            <select
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value as ID | "")}
              className="w-full rounded-xl border px-3 py-3"
            >
              <option value="">すべて</option>
              {store.groups
                .sort((a,b)=>a.createdAt-b.createdAt)
                .map(g => (
                <option key={g.id} value={g.id}>
                  {g.name}{g.serverId ? "" : "（未同期）"}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-xl border p-4">
          <h2 className="font-semibold mb-3">カード</h2>
          <div className="flex gap-2">
            <input
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              placeholder="例: 単語 / 文法"
              className="w-full rounded-xl border px-3 py-3"
              aria-label="カード名"
            />
            <button
              onClick={addCard}
              disabled={!selectedGroupId}
              className="rounded-xl border px-4 py-3 hover:bg-gray-50 disabled:opacity-40"
              title={!selectedGroupId ? "先にグループを選択してください" : ""}
            >
              追加
            </button>
          </div>

          <div className="mt-3">
            <select
              value={selectedCardId}
              onChange={(e) => setSelectedCardId(e.target.value as ID | "")}
              className="w-full rounded-xl border px-3 py-3"
            >
              <option value="">カードを選択</option>
              {cardsInSelectedGroup
                .sort((a,b)=>a.createdAt-b.createdAt)
                .map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}（{groupMap[c.groupId]?.name ?? "—"}）{c.serverId ? "" : "（未同期）"}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* 計測コントロール（モバイルボタン拡大） */}
      <section className="rounded-xl border p-4">
        <h2 className="font-semibold mb-3">計測</h2>
        <div className="flex flex-wrap items-center gap-3">
          {!running ? (
            <button
              onClick={startWork}
              disabled={!selectedCardId}
              className="rounded-xl bg-black px-6 h-14 min-w-[140px] text-white text-base font-semibold disabled:bg-gray-300"
            >
              作業開始
            </button>
          ) : (
            <>
              <button
                onClick={stopWork}
                className="rounded-xl bg-gray-800 px-6 h-14 min-w-[140px] text-white text-base font-semibold"
              >
                作業終了
              </button>
              <div className="text-sm text-gray-700">
                計測中: <b>{cardMap[running.cardId]?.name ?? "?"}</b>（{fmtHMS(runningElapsedSec)}）
              </div>
              <input
                value={note}
                onChange={(e)=>setNote(e.target.value)}
                placeholder="メモ（任意）"
                className="rounded-xl border px-3 py-3"
              />
            </>
          )}
        </div>
      </section>

      {/* カレンダー（日ビュー：タイムボクシング） */}
      <section className="rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">カレンダー（日・JST）</h2>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className="rounded-xl border px-3 py-3"
          />
        </div>

        <TimeBoxingDay
          sessions={sessionsToday}
          cardMap={cardMap}
          dayStart={currentDayStart}
          dayEnd={currentDayEnd}
        />

        <div className="mt-3 text-sm text-gray-700">
          本日の合計：<b>{fmtHMS(totalSecondsToday)}</b>
        </div>
      </section>

      {/* セッション一覧（当日 / 表示・編集ともJST） */}
      <section className="rounded-xl border p-4">
        <h2 className="font-semibold mb-3">当日のセッション一覧（JST）</h2>
        <ul className="space-y-2">
          {sessionsToday.map(s => {
            const st = clamp(s.start, currentDayStart, currentDayEnd);
            const et = clamp(s.end ?? Date.now(), currentDayStart, currentDayEnd);
            const startInput = toInputJST(s.start);
            const endInput   = toInputJST(s.end ?? Date.now());
            return (
              <li key={s.id} className="rounded-xl border p-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <div className="font-medium">
                    {cardMap[s.cardId]?.name ?? "?"}
                    <span className="ml-2 text-xs text-gray-500">
                      {fmtTimeJST(st)} — {s.end ? fmtTimeJST(et) : "（計測中）"}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {fmtHMS(secondsBetween(s.start, s.end ?? Date.now()))}
                    {s.note ? <span className="ml-2">📝 {s.note}</span> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center gap-1">
                    <input
                      type="datetime-local"
                      defaultValue={startInput}
                      className="rounded-lg border px-2 py-2 text-sm"
                      onChange={(e) => updateSessionTimes(s.id, e.target.value, endInput)}
                    />
                    <span className="text-sm text-gray-500">〜</span>
                    <input
                      type="datetime-local"
                      defaultValue={endInput}
                      className="rounded-lg border px-2 py-2 text-sm"
                      onChange={(e) => updateSessionTimes(s.id, startInput, e.target.value)}
                      disabled={!s.end}
                      title={!s.end ? "計測中は終了時刻を編集できません" : ""}
                    />
                  </div>
                  <button
                    onClick={() => deleteSession(s.id)}
                    className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    削除
                  </button>
                </div>
              </li>
            );
          })}
          {sessionsToday.length === 0 && (
            <li className="text-sm text-gray-500">当日のセッションはありません。</li>
          )}
        </ul>
      </section>
    </div>
  );
}

/** ========== タイムボクシング（日ビュー） ========== */
function TimeBoxingDay({
  sessions,
  cardMap,
  dayStart,
  dayEnd,
}: {
  sessions: Session[];
  cardMap: Record<string, Card | undefined>;
  dayStart: number; // JST 00:00 (UTC ms)
  dayEnd: number;
}) {
  const minutesPerDay = 24 * 60;
  const PX_PER_MIN = 1;     // 1px / 分（= 1440px）
  const TOP = 8;            // 上マージン（ラベル/ライン/ブロック全てで共有）
  const LABEL_W = 64;       // 左の時刻幅（px）
  const gridHeight = minutesPerDay * PX_PER_MIN + TOP;

  return (
    <div className="relative" style={{ height: gridHeight }}>
      {/* 左：時刻ラベル（同じ座標系） */}
      <div
        className="absolute left-0 top-0"
        style={{ width: LABEL_W, height: gridHeight }}
        aria-hidden
      >
        {Array.from({ length: 25 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-0 w-full"
            style={{ top: TOP + i * 60 * PX_PER_MIN }}
          >
            <div className="pl-2 text-xs text-gray-500 leading-none tabular-nums">
              {String(i).padStart(2, "0")}:00
            </div>
          </div>
        ))}
      </div>

      {/* 右：レーン（ライン & ブロック） */}
      <div
        className="absolute right-0 top-0 rounded-xl border bg-white"
        style={{ left: LABEL_W + 8, height: gridHeight }} // ラベル幅 + 余白
      >
        {/* hour lines（JST） */}
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-0 w-full border-t border-dashed border-gray-200"
            style={{ top: TOP + i * 60 * PX_PER_MIN }}
          />
        ))}

        {/* blocks */}
        {sessions.map((s) => {
          const startMin = (s.start - dayStart) / 60000;
          const endMin = ((s.end ?? Date.now()) - dayStart) / 60000;
          const top = clamp(startMin, 0, minutesPerDay) * PX_PER_MIN;
          const bottom = clamp(endMin, 0, minutesPerDay) * PX_PER_MIN;
          const height = Math.max(2, bottom - top);

          const a = clamp(s.start, dayStart, dayEnd);
          const b = clamp(s.end ?? Date.now(), dayStart, dayEnd);
          const durSec = secondsBetween(a, b);

          const color = cardMap[s.cardId]?.color ?? "#000";
          const label = cardMap[s.cardId]?.name ?? "未定義";
          return (
            <div
              key={s.id}
              className="absolute left-2 right-2 rounded-md shadow-sm text-xs"
              style={{
                top: TOP + top,
                height,
                background: withAlpha(color, 0.12),
                borderLeft: `4px solid ${color}`,
                padding: "6px",
              }}
              title={`${label} (${fmtHMS(durSec)})`}
            >
              <div className="font-medium">{label}</div>
              <div className="text-[11px] text-gray-600">
                {fmtHMS(durSec)}
                {s.note ? <span className="ml-1">/ {s.note}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** ========== 見た目ユーティリティ ========== */
function pickColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 80% 45%)`;
}
function withAlpha(hsl: string, alpha: number) {
  if (hsl.startsWith("hsl(")) return hsl.replace(")", ` / ${alpha})`);
  if (hsl.startsWith("hsl")) return `${hsl} / ${alpha}`;
  return hsl;
}
function fmtHMS(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}時間${String(m).padStart(2,"0")}分${String(s).padStart(2,"0")}秒`;
  if (m > 0) return `${m}分${String(s).padStart(2,"0")}秒`;
  return `${s}秒`;
}
