// src/features/nudge/techniques/minimum-quota.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

type Quota = {
  id: ID;
  title: string;
  note?: string;
  createdAt: number;
};

type DayState = {
  // その日に「設定した」ノルマID（順序維持）
  quotaIds: ID[];
  // 達成チェック：true=○ / false=× / undefined=未チェック
  checks: Record<ID, boolean | undefined>;
};

type StoreV1 = {
  quotas: Record<ID, Quota>;
  days: Record<string, DayState>; // key: YYYY-MM-DD
  version: 1;
};

type Store = StoreV1;

const LOCAL_KEY = "minimum_quota_v1";
const DOC_KEY = "minimum_quota_v1";

// 手動同期（ホームと同じ）
const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

function uid(): string {
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
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}
function getToday(): string {
  return toKey(new Date());
}
function addDaysKey(dateKey: string, deltaDays: number): string {
  const dt = fromKey(dateKey);
  if (!dt) return dateKey;
  dt.setDate(dt.getDate() + deltaDays);
  return toKey(dt);
}
function formatJapaneseDate(dateStr: string): string {
  const dt = fromKey(dateStr);
  if (!dt) return dateStr;
  const weekdayJa = ["日", "月", "火", "水", "木", "金", "土"];
  const w = weekdayJa[dt.getDay()];
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日（${w}）`;
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

function createDefaultStore(): Store {
  return {
    quotas: {},
    days: {},
    version: 1,
  };
}

function isStoreV1(x: any): x is StoreV1 {
  return !!x && x.version === 1 && typeof x.quotas === "object" && typeof x.days === "object";
}

function migrate(raw: any): Store {
  // 今は v1 しか無い。将来 v2 以上が来たらここで対応。
  if (isStoreV1(raw)) {
    // 防御的に整形
    const quotas: Store["quotas"] = {};
    for (const [id, q] of Object.entries(raw.quotas ?? {})) {
      if (!q || typeof (q as any).title !== "string") continue;
      quotas[id] = {
        id,
        title: String((q as any).title ?? "").slice(0, 200),
        note: typeof (q as any).note === "string" ? (q as any).note : undefined,
        createdAt: typeof (q as any).createdAt === "number" ? (q as any).createdAt : Date.now(),
      };
    }

    const days: Store["days"] = {};
    for (const [dateKey, d] of Object.entries(raw.days ?? {})) {
      if (!d || typeof d !== "object") continue;
      const quotaIds = Array.isArray((d as any).quotaIds)
        ? uniqKeepOrder((d as any).quotaIds.filter((x: any) => typeof x === "string"))
        : [];
      const checksIn = (d as any).checks ?? {};
      const checks: Record<ID, boolean | undefined> = {};
      for (const id of quotaIds) {
        const v = checksIn?.[id];
        if (v === true || v === false) checks[id] = v;
      }
      days[dateKey] = { quotaIds, checks };
    }

    return { quotas, days, version: 1 };
  }

  return createDefaultStore();
}

function loadLocal(): Store {
  try {
    if (typeof window === "undefined") return createDefaultStore();
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createDefaultStore();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
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

function ensureDay(store: Store, dateKey: string): DayState {
  const d = store.days[dateKey];
  if (d) return d;
  return { quotaIds: [], checks: {} };
}

function summarizeDay(store: Store, dateKey: string) {
  const d = store.days[dateKey];
  if (!d || d.quotaIds.length === 0) return { total: 0, done: 0, fail: 0, pending: 0 };
  let done = 0,
    fail = 0,
    pending = 0;
  for (const id of d.quotaIds) {
    const v = d.checks?.[id];
    if (v === true) done++;
    else if (v === false) fail++;
    else pending++;
  }
  return { total: d.quotaIds.length, done, fail, pending };
}

/** 指定日より前で、ノルマが設定されている直近の日付キーを探す（無ければ null） */
function findLatestConfiguredDayBefore(store: Store, dateKey: string): string | null {
  const keys = Object.keys(store.days ?? {});
  if (keys.length === 0) return null;

  // dateKey より前だけに絞って、最大（最新）を取る
  const candidates = keys.filter((k) => k < dateKey && (store.days[k]?.quotaIds?.length ?? 0) > 0);
  if (candidates.length === 0) return null;
  candidates.sort(); // 昇順
  return candidates[candidates.length - 1];
}

export default function MinimumQuota() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  const [selectedDate, setSelectedDate] = useState<string>(() => getToday());

  // localStorage 即時保存（サーバ反映はホーム📥/☁のみ）
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // 手動同期の合図を購読（PULL / PUSH / LOCAL_DOC_APPLIED / storage）
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<any>(DOC_KEY);
        if (!remote) return;
        const next = migrate(remote);
        setStore(next);
        saveLocal(next);
      } catch (e) {
        console.warn("[minimum-quota] manual PULL failed:", e);
      }
    };

    const doPush = async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, storeRef.current);
      } catch (e) {
        console.warn("[minimum-quota] manual PUSH failed:", e);
      }
    };

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
            // noop（直後にPULLが来る想定）
          } else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            setStore(loadLocal());
          }
        };
      }
    } catch {
      // noop
    }

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

    const onStorage = (ev: StorageEvent) => {
      if (!ev.key) return;
      if (ev.key === LOCAL_KEY && ev.newValue) {
        try {
          setStore(migrate(JSON.parse(ev.newValue)));
        } catch {
          // noop
        }
      }
      if (ev.key === STORAGE_KEY_RESET_REQ) {
        // noop
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      try {
        bc?.close();
      } catch {}
      window.removeEventListener("message", onWinMsg);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const day = useMemo(() => ensureDay(store, selectedDate), [store, selectedDate]);
  const daySummary = useMemo(() => summarizeDay(store, selectedDate), [store, selectedDate]);

  const orderedQuotas = useMemo(() => {
    const out: Array<{ q: Quota; check: boolean | undefined }> = [];
    for (const id of day.quotaIds) {
      const q = store.quotas[id];
      if (!q) continue;
      out.push({ q, check: day.checks?.[id] });
    }
    return out;
  }, [day.quotaIds, day.checks, store.quotas]);

  const jumpToday = () => setSelectedDate(getToday());
  const jumpPrevDay = () => setSelectedDate((d) => addDaysKey(d, -1));
  const jumpNextDay = () => setSelectedDate((d) => addDaysKey(d, +1));

  const addQuotaForDay = () => {
    const title = prompt("今日の最低ノルマを入力してください（例：英単語10個 / 5分だけ着手）");
    if (!title) return;
    const trimmed = title.trim();
    if (!trimmed) return;

    const id = uid();
    const q: Quota = { id, title: trimmed, createdAt: Date.now() };

    setStore((s) => {
      const d = ensureDay(s, selectedDate);
      const nextQuotaIds = uniqKeepOrder([...d.quotaIds, id]);

      return {
        ...s,
        quotas: { ...s.quotas, [id]: q },
        days: {
          ...s.days,
          [selectedDate]: { ...d, quotaIds: nextQuotaIds },
        },
      };
    });
  };

  /** ★追加：前日（正確には「直前に設定がある日」）と同じノルマを、この日に丸ごと揃える */
  const copyAllFromPreviousDay = () => {
    setStore((s) => {
      const targetDate = selectedDate || getToday();

      const prevKey = findLatestConfiguredDayBefore(s, targetDate) ?? addDaysKey(targetDate, -1);
      const prevDay = s.days?.[prevKey];

      if (!prevDay || (prevDay.quotaIds?.length ?? 0) === 0) {
        alert("前日（または直近の日）にノルマがありません。");
        return s;
      }

      const curDay = ensureDay(s, targetDate);
      const hasCurrent = (curDay.quotaIds?.length ?? 0) > 0;

      const msg = hasCurrent
        ? `「${formatJapaneseDate(prevKey)}」のノルマで、この日のノルマを上書きします。\n（この日の○×チェックはリセットされます）\nよろしいですか？`
        : `「${formatJapaneseDate(prevKey)}」と同じノルマを、この日に設定します。\nよろしいですか？`;

      if (!confirm(msg)) return s;

      // 参照するノルマIDのうち、現 store.quotas に実体があるものだけ残す
      const ids = uniqKeepOrder(prevDay.quotaIds.filter((id) => !!s.quotas[id]));

      // もし quotas 側が掃除されていて空になった場合は何もしない
      if (ids.length === 0) {
        alert("前日のノルマ定義が見つかりませんでした（データ不整合）。");
        return s;
      }

      return {
        ...s,
        days: {
          ...s.days,
          [targetDate]: {
            quotaIds: ids,
            checks: {}, // ★揃えた日は未チェックにする（毎日のチェック運用）
          },
        },
      };
    });
  };

  const renameQuota = (id: ID) => {
    const q = store.quotas[id];
    if (!q) return;
    const next = prompt("ノルマを変更してください", q.title);
    if (!next) return;
    const trimmed = next.trim();
    if (!trimmed) return;

    setStore((s) => ({
      ...s,
      quotas: {
        ...s.quotas,
        [id]: { ...s.quotas[id], title: trimmed },
      },
    }));
  };

  const editNote = (id: ID) => {
    const q = store.quotas[id];
    if (!q) return;
    const next = prompt("メモ（任意）を入力してください", q.note ?? "");
    if (next === null) return; // キャンセル
    const trimmed = next.trim();
    setStore((s) => ({
      ...s,
      quotas: {
        ...s.quotas,
        [id]: { ...s.quotas[id], note: trimmed ? trimmed : undefined },
      },
    }));
  };

  const setCheck = (id: ID, v: boolean | undefined) => {
    setStore((s) => {
      const d = ensureDay(s, selectedDate);
      const nextChecks = { ...(d.checks ?? {}) };
      if (v === undefined) delete nextChecks[id];
      else nextChecks[id] = v;

      return {
        ...s,
        days: {
          ...s.days,
          [selectedDate]: { ...d, checks: nextChecks },
        },
      };
    });
  };

  const removeQuotaFromDay = (id: ID) => {
    const q = store.quotas[id];
    const label = q?.title ? `「${q.title}」` : "このノルマ";
    if (!confirm(`${label}をこの日から外しますか？（ノルマ自体も削除します）`)) return;

    setStore((s) => {
      const d = ensureDay(s, selectedDate);
      const nextQuotaIds = d.quotaIds.filter((x) => x !== id);
      const nextChecks = { ...(d.checks ?? {}) };
      delete nextChecks[id];

      // quotas からも消す（シンプル運用）
      const nextQuotas = { ...s.quotas };
      delete nextQuotas[id];

      const nextDays = { ...s.days };
      if (nextQuotaIds.length === 0 && Object.keys(nextChecks).length === 0) {
        delete nextDays[selectedDate];
      } else {
        nextDays[selectedDate] = { quotaIds: nextQuotaIds, checks: nextChecks };
      }

      return { ...s, quotas: nextQuotas, days: nextDays };
    });
  };

  const clearAllForDay = () => {
    if (day.quotaIds.length === 0) return;
    if (!confirm("この日の最低ノルマを全て削除します（ノルマ自体も削除）。よろしいですか？"))
      return;

    setStore((s) => {
      const d = ensureDay(s, selectedDate);

      const nextQuotas = { ...s.quotas };
      for (const id of d.quotaIds) delete nextQuotas[id];

      const nextDays = { ...s.days };
      delete nextDays[selectedDate];

      return { ...s, quotas: nextQuotas, days: nextDays };
    });
  };

  const canCopyFromPrev = useMemo(() => {
    const prev = findLatestConfiguredDayBefore(store, selectedDate);
    if (!prev) return false;
    return (store.days?.[prev]?.quotaIds?.length ?? 0) > 0;
  }, [store, selectedDate]);

  const prevConfiguredLabel = useMemo(() => {
    const prev = findLatestConfiguredDayBefore(store, selectedDate);
    if (!prev) return null;
    return prev;
  }, [store, selectedDate]);

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* 左：日付操作 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-2">日付</h2>

        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={jumpPrevDay}
            className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
          >
            ← 前日
          </button>
          <button
            type="button"
            onClick={jumpToday}
            className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
          >
            今日
          </button>
          <button
            type="button"
            onClick={jumpNextDay}
            className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
          >
            翌日 →
          </button>
        </div>

        <label className="block text-xs text-gray-600 mb-2">日付を直接指定</label>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-full rounded-xl border px-3 py-2 text-sm"
        />

        <div className="mt-4 rounded-xl border bg-gray-50 p-3">
          <div className="text-sm font-semibold mb-1">{formatJapaneseDate(selectedDate)}</div>
          <div className="text-xs text-gray-700">
            合計: {daySummary.total} / ○: {daySummary.done} / ×: {daySummary.fail} / 未:{" "}
            {daySummary.pending}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addQuotaForDay}
            className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
          >
            ＋ 今日のノルマを追加
          </button>

          <button
            type="button"
            onClick={copyAllFromPreviousDay}
            disabled={!canCopyFromPrev && day.quotaIds.length === 0}
            className={
              "rounded-xl border px-3 py-2 text-xs " +
              ((canCopyFromPrev || day.quotaIds.length > 0) ? "hover:bg-gray-50" : "opacity-50")
            }
            title={
              prevConfiguredLabel
                ? `直近：${formatJapaneseDate(prevConfiguredLabel)} と同じノルマを揃える`
                : "前日（または直近の日）にノルマが無いと使えません"
            }
          >
            前日と同じに揃える
          </button>

          {day.quotaIds.length > 0 && (
            <button
              type="button"
              onClick={clearAllForDay}
              className="rounded-xl border px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
            >
              この日を全削除
            </button>
          )}
        </div>

        {prevConfiguredLabel && (
          <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
            直近の設定日：{formatJapaneseDate(prevConfiguredLabel)}（ここからコピーします）
          </p>
        )}

        <p className="text-xs text-gray-500 mt-3 leading-relaxed">
          「最低ノルマ」は“ゼロを防ぐ”ための最小行動。
          1日の終わりに○/×でチェックして、次の日に繋げます。
        </p>
      </section>

      {/* 右：当日のノルマ一覧 + ○×チェック */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[240px]">
        <div className="flex flex-wrap items-baseline gap-2 mb-3">
          <h2 className="font-semibold">{formatJapaneseDate(selectedDate)} の最低ノルマ</h2>

          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={addQuotaForDay}
              className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
            >
              追加
            </button>
            <button
              type="button"
              onClick={copyAllFromPreviousDay}
              className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
              title="前日（または直近の日）と同じノルマを、この日に揃えて設定します"
            >
              前日コピー
            </button>
          </div>
        </div>

        {orderedQuotas.length === 0 ? (
          <div className="rounded-xl border bg-gray-50 p-4">
            <p className="text-sm text-gray-700">この日の最低ノルマがまだありません。</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addQuotaForDay}
                className="rounded-xl border px-3 py-2 text-xs hover:bg-white"
              >
                まず1つ追加する
              </button>
              <button
                type="button"
                onClick={copyAllFromPreviousDay}
                className="rounded-xl border px-3 py-2 text-xs hover:bg-white"
              >
                前日と同じに揃える
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {orderedQuotas.map(({ q, check }) => (
              <div key={q.id} className="rounded-2xl border p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="text-sm font-semibold leading-relaxed">{q.title}</div>
                    {q.note && <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{q.note}</div>}
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCheck(q.id, true)}
                      className={
                        "rounded-xl border px-3 py-1.5 text-xs " +
                        (check === true ? "bg-black text-white border-black" : "hover:bg-gray-50")
                      }
                      title="達成（○）"
                    >
                      ○
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheck(q.id, false)}
                      className={
                        "rounded-xl border px-3 py-1.5 text-xs " +
                        (check === false ? "bg-black text-white border-black" : "hover:bg-gray-50")
                      }
                      title="未達（×）"
                    >
                      ×
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheck(q.id, undefined)}
                      className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                      title="未チェックに戻す"
                    >
                      －
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => renameQuota(q.id)}
                    className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => editNote(q.id)}
                    className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    メモ
                  </button>
                  <button
                    type="button"
                    onClick={() => removeQuotaFromDay(q.id)}
                    className="rounded-xl border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    削除
                  </button>

                  <span className="ml-auto text-[10px] text-gray-500">
                    チェック：{check === true ? "○" : check === false ? "×" : "未"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-500 mt-3">
          端末ローカルには即時保存、サーバ反映はホームの📥/☁（手動同期）で行われます。
        </p>
      </section>
    </div>
  );
}
