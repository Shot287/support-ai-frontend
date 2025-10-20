// src/features/nudge/techniques/plan-timeboxing.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** ===================== 型 ===================== */
type ID = string;

/** 作業記録（worklog_v1）と同じ構造の一部を参照 */
type Group = { id: ID; name: string; color?: string; createdAt: number; serverId?: string };
type Card  = { id: ID; groupId: ID; name: string; color?: string; createdAt: number; serverId?: string };

type WorklogStore = {
  groups: Group[];
  cards: Card[];
  sessions?: unknown[]; // 互換用
  version: 1;
};

/** 計画データ（このページ専用・ローカル保存） */
type PlanItem = {
  id: ID;
  cardId: ID;
  start: number; // epoch ms (UTC)
  end: number;   // epoch ms (UTC)
  note?: string;
};
type PlanStore = {
  items: PlanItem[];
  version: 1;
};

/** ===================== 定数 ===================== */
const WORKLOG_KEY = "worklog_v1";
const PLAN_KEY = "plan_v1";

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** ===================== JSTユーティリティ ===================== */
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
  // JST 0:00 → UTC に直して ms
  return Date.parse(`${yyyyMmDd}T00:00:00+09:00`);
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function secondsBetween(a: number, b: number) {
  return Math.max(0, Math.floor((b - a) / 1000));
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
function fmtHMS(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}時間${String(m).padStart(2,"0")}分${String(s).padStart(2,"0")}秒`;
  if (m > 0) return `${m}分${String(s).padStart(2,"0")}秒`;
  return `${s}秒`;
}

/** HH:MM（JST）→ epoch ms（UTC） */
function timeToUtcMsOnDateJST(dateStr: string, hhmm: string): number {
  const [hh, mm] = hhmm.split(":").map((x) => parseInt(x || "0", 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return NaN;
  return Date.parse(`${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+09:00`);
}
/** epoch ms（UTC）→ HH:MM（JST） */
function utcMsToTimeJST(ms: number): string {
  const d = new Date(ms);
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

/** ===================== ストアIO ===================== */
function loadWorklog(): WorklogStore {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(WORKLOG_KEY) : null;
    if (!raw) return { groups: [], cards: [], sessions: [], version: 1 };
    const parsed = JSON.parse(raw) as WorklogStore;
    return parsed?.version ? parsed : { groups: [], cards: [], sessions: [], version: 1 };
  } catch {
    return { groups: [], cards: [], sessions: [], version: 1 };
  }
}
function loadPlan(): PlanStore {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(PLAN_KEY) : null;
    if (!raw) return { items: [], version: 1 };
    const parsed = JSON.parse(raw) as PlanStore;
    return parsed?.version ? parsed : { items: [], version: 1 };
  } catch {
    return { items: [], version: 1 };
  }
}
function savePlan(s: PlanStore) {
  if (typeof window !== "undefined") {
    localStorage.setItem(PLAN_KEY, JSON.stringify(s));
  }
}

/** ===================== 見た目ユーティリティ ===================== */
function withAlpha(hsl: string, alpha: number) {
  if (hsl.startsWith("hsl(")) return hsl.replace(")", ` / ${alpha})`);
  if (hsl.startsWith("hsl")) return `${hsl} / ${alpha}`;
  return hsl;
}

/** ===================== 本体 ===================== */
export default function PlanTimeBoxing() {
  const [worklog, setWorklog] = useState<WorklogStore>(() => loadWorklog());
  const [plan, setPlan] = useState<PlanStore>(() => loadPlan());

  // 対象日（JST）
  const [dateStr, setDateStr] = useState<string>(() => todayJstStr());
  const dayStart = useMemo(() => jstDayStartMs(dateStr), [dateStr]);
  const dayEnd   = dayStart + 24 * 60 * 60 * 1000 - 1;

  // 追加フォーム
  const [selectedGroupId, setSelectedGroupId] = useState<ID | "">("");
  const [selectedCardId, setSelectedCardId]   = useState<ID | "">("");
  const [startTime, setStartTime] = useState<string>("09:00");
  const [endTime, setEndTime]     = useState<string>("10:00");
  const [note, setNote]           = useState<string>("");

  // 編集用（インライン）
  const [editingId, setEditingId] = useState<ID | null>(null);
  const [tmpStart, setTmpStart] = useState<string>("");
  const [tmpEnd, setTmpEnd] = useState<string>("");
  const [tmpNote, setTmpNote] = useState<string>("");

  // リアルタイム合計（現在時刻に依存しない）
  const plansToday = useMemo(
    () => plan.items
      .filter((it) => !(it.end < dayStart || it.start > dayEnd))
      .sort((a, b) => a.start - b.start),
    [plan.items, dayStart, dayEnd]
  );
  const totalSeconds = useMemo(
    () => plansToday.reduce((acc, s) => {
      const a = clamp(s.start, dayStart, dayEnd);
      const b = clamp(s.end, dayStart, dayEnd);
      return acc + secondsBetween(a, b);
    }, 0),
    [plansToday, dayStart, dayEnd]
  );

  const groupMap = useMemo(() => Object.fromEntries(worklog.groups.map(g => [g.id, g])), [worklog.groups]);
  const cardMap  = useMemo(() => Object.fromEntries(worklog.cards.map(c => [c.id, c])), [worklog.cards]);

  const cardsInSelected = useMemo(
    () => worklog.cards.filter(c => !selectedGroupId ? true : c.groupId === selectedGroupId),
    [worklog.cards, selectedGroupId]
  );

  useEffect(() => {
    // 作業記録側が変更された場合に追従（作業記録ページでグループ/カード追加後など）
    const onStorage = (e: StorageEvent) => {
      if (e.key === WORKLOG_KEY) {
        setWorklog(loadWorklog());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => savePlan(plan), [plan]);

  /** ---------- 追加 ---------- */
  const addPlan = () => {
    if (!selectedCardId) {
      alert("カードを選択してください。");
      return;
    }
    const s = timeToUtcMsOnDateJST(dateStr, startTime);
    const e = timeToUtcMsOnDateJST(dateStr, endTime);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) {
      alert("開始と終了の時刻を確認してください。");
      return;
    }
    const item: PlanItem = { id: uid(), cardId: selectedCardId as ID, start: s, end: e, note: note.trim() || undefined };
    setPlan((p) => ({ ...p, items: [...p.items, item] }));
    setNote("");
  };

  /** ---------- 編集 ---------- */
  const startEdit = (id: ID) => {
    const it = plan.items.find(x => x.id === id);
    if (!it) return;
    setEditingId(id);
    setTmpStart(utcMsToTimeJST(it.start));
    setTmpEnd(utcMsToTimeJST(it.end));
    setTmpNote(it.note ?? "");
  };
  const commitEdit = () => {
    if (!editingId) return;
    const s = timeToUtcMsOnDateJST(dateStr, tmpStart);
    const e = timeToUtcMsOnDateJST(dateStr, tmpEnd);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) {
      alert("編集後の開始/終了時刻が不正です。");
      return;
    }
    setPlan((p) => ({
      ...p,
      items: p.items.map((x) => x.id === editingId ? { ...x, start: s, end: e, note: tmpNote.trim() || undefined } : x),
    }));
    setEditingId(null);
  };

  /** ---------- 削除 ---------- */
  const removePlan = (id: ID) => {
    setPlan((p) => ({ ...p, items: p.items.filter(x => x.id !== id) }));
  };

  /** ---------- 補助：簡易スナップ（5分刻み） ---------- */
  const onBlurSnap = (setter: (v: string) => void) => (e: React.FocusEvent<HTMLInputElement>) => {
    const v = e.target.value;
    const [H, M] = v.split(":").map((n) => parseInt(n || "0", 10));
    if (Number.isNaN(H) || Number.isNaN(M)) return;
    const snapped = Math.round(M / 5) * 5;
    setter(`${String(H).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`);
  };

  return (
    <div className="rounded-2xl border p-4 sm:p-6 shadow-sm grid gap-6">
      {/* 上段：当日選択 */}
      <section className="rounded-xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">対象日（JST）</h2>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className="rounded-xl border px-3 py-3"
          />
        </div>
      </section>

      {/* 計画の追加 */}
      <section className="rounded-xl border p-4">
        <h2 className="font-semibold mb-3">計画を追加</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border p-3">
            <div className="text-sm text-gray-600 mb-2">カードの選択</div>
            <div className="flex gap-2">
              <select
                value={selectedGroupId}
                onChange={(e) => {
                  setSelectedGroupId(e.target.value as ID | "");
                  setSelectedCardId(""); // グループ変更時はカード選択をリセット
                }}
                className="w-1/2 rounded-xl border px-3 py-3"
              >
                <option value="">すべてのグループ</option>
                {worklog.groups.sort((a,b)=>a.createdAt-b.createdAt).map(g => (
                  <option key={g.id} value={g.id}>
                    {g.name}{g.serverId ? "" : "（未同期）"}
                  </option>
                ))}
              </select>

              <select
                value={selectedCardId}
                onChange={(e) => setSelectedCardId(e.target.value as ID | "")}
                className="w-1/2 rounded-xl border px-3 py-3"
              >
                <option value="">カードを選択</option>
                {cardsInSelected.sort((a,b)=>a.createdAt-b.createdAt).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}（{groupMap[c.groupId]?.name ?? "—"}）{c.serverId ? "" : "（未同期）"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl border p-3">
            <div className="text-sm text-gray-600 mb-2">時間とメモ</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="time"
                step={300}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                onBlur={onBlurSnap(setStartTime)}
                className="rounded-xl border px-3 py-3"
                aria-label="開始時刻"
              />
              <span className="text-sm text-gray-500">〜</span>
              <input
                type="time"
                step={300}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                onBlur={onBlurSnap(setEndTime)}
                className="rounded-xl border px-3 py-3"
                aria-label="終了時刻"
              />
              <input
                value={note}
                onChange={(e)=>setNote(e.target.value)}
                placeholder="メモ（任意）"
                className="min-w-[200px] flex-1 rounded-xl border px-3 py-3"
              />
              <button
                onClick={addPlan}
                disabled={!selectedCardId}
                className="rounded-xl bg-black px-5 py-3 text-white font-semibold disabled:bg-gray-300"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* タイムボクシング（日ビュー） */}
      <section className="rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">タイムライン（日・計画 / JST）</h2>
          <div className="text-sm text-gray-700">
            予定合計：<b>{fmtHMS(totalSeconds)}</b>
          </div>
        </div>

        <TimeBoxingDay
          items={plansToday}
          cardMap={cardMap}
          dayStart={dayStart}
          dayEnd={dayEnd}
        />
      </section>

      {/* 一覧（編集・削除） */}
      <section className="rounded-xl border p-4">
        <h2 className="font-semibold mb-3">当日の計画一覧（編集可）</h2>
        <ul className="space-y-2">
          {plansToday.map((s) => {
            const startHHMM = utcMsToTimeJST(s.start);
            const endHHMM   = utcMsToTimeJST(s.end);
            const dur = secondsBetween(s.start, s.end);
            const card = cardMap[s.cardId];
            const isEditing = editingId === s.id;

            return (
              <li key={s.id} className="rounded-xl border p-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <div className="font-medium">
                    {card?.name ?? "?"}
                    <span className="ml-2 text-xs text-gray-500">
                      {fmtTimeJST(s.start)} — {fmtTimeJST(s.end)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {fmtHMS(dur)}{s.note ? <span className="ml-2">📝 {s.note}</span> : null}
                  </div>

                  {isEditing && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        step={300}
                        value={tmpStart}
                        onChange={(e)=>setTmpStart(e.target.value)}
                        onBlur={onBlurSnap(setTmpStart)}
                        className="rounded-lg border px-2 py-2 text-sm"
                      />
                      <span className="text-sm text-gray-500">〜</span>
                      <input
                        type="time"
                        step={300}
                        value={tmpEnd}
                        onChange={(e)=>setTmpEnd(e.target.value)}
                        onBlur={onBlurSnap(setTmpEnd)}
                        className="rounded-lg border px-2 py-2 text-sm"
                      />
                      <input
                        value={tmpNote}
                        onChange={(e)=>setTmpNote(e.target.value)}
                        placeholder="メモ（任意）"
                        className="rounded-lg border px-2 py-2 text-sm min-w-[200px] flex-1"
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {!isEditing ? (
                    <>
                      <button
                        onClick={() => startEdit(s.id)}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => removePlan(s.id)}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        削除
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={commitEdit}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        取消
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
          {plansToday.length === 0 && (
            <li className="text-sm text-gray-500">当日の計画はありません。</li>
          )}
        </ul>

        {/* 一括操作 */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => {
              if (!confirm("当日の計画をすべて削除します。よろしいですか？")) return;
              setPlan((p) => ({ ...p, items: p.items.filter(x => x.end < dayStart || x.start > dayEnd) }));
            }}
            className="rounded-xl border px-4 py-2 hover:bg-gray-50"
          >
            当日の計画を全削除
          </button>
          <button
            onClick={() => {
              // 予定を時間順に再整列（保存内容はそのまま、表示順だけ整う）
              setPlan((p) => ({ ...p, items: p.items.slice().sort((a,b)=>a.start-b.start) }));
            }}
            className="rounded-xl border px-4 py-2 hover:bg-gray-50"
          >
            並び順を整える
          </button>
        </div>
      </section>
    </div>
  );
}

/** ===================== タイムボクシング（日ビュー） ===================== */
function TimeBoxingDay({
  items,
  cardMap,
  dayStart,
  dayEnd,
}: {
  items: PlanItem[];
  cardMap: Record<string, Card | undefined>;
  dayStart: number; // JST 00:00 (UTC ms)
  dayEnd: number;
}) {
  const minutesPerDay = 24 * 60;
  const PX_PER_MIN = 1;     // 1px / 分（= 1440px）
  const TOP = 8;            // 上マージン
  const LABEL_W = 64;       // 左の時刻幅（px）
  const gridHeight = minutesPerDay * PX_PER_MIN + TOP;

  return (
    <div className="relative" style={{ height: gridHeight }}>
      {/* 左：時刻ラベル */}
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
        {/* 時間線（JST） */}
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-0 w-full border-t border-dashed border-gray-200"
            style={{ top: TOP + i * 60 * PX_PER_MIN }}
          />
        ))}

        {/* ブロック */}
        {items.map((s) => {
          const startMin = (s.start - dayStart) / 60000;
          const endMin = (s.end - dayStart) / 60000;
          const top = clamp(startMin, 0, minutesPerDay) * PX_PER_MIN;
          const bottom = clamp(endMin, 0, minutesPerDay) * PX_PER_MIN;
          const height = Math.max(2, bottom - top);

          const a = clamp(s.start, dayStart, dayEnd);
          const b = clamp(s.end, dayStart, dayEnd);
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
