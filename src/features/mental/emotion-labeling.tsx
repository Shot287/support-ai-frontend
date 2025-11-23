// src/features/mental/emotion-labeling.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

/* ======================= 型 ======================= */

type BigEmotion = {
  id: ID;
  name: string;       // 例: 不安, 怒り
  createdAt: number;
};

type FineEmotion = {
  id: ID;
  bigId: ID;         // 所属する大きな感情
  name: string;      // 例: 足搔く, 気が急く
  createdAt: number;
};

type EmotionLabel = {
  fineEmotionId: ID;
  intensity: number; // 0〜100（％）
};

type EmotionRecord = {
  id: ID;
  date: string;       // "2025-11-23" 形式（JST）
  situation: string;  // その状況の説明
  labels: EmotionLabel[]; // 細かい感情3つまで
  createdAt: number;
  updatedAt: number;
};

type Store = {
  bigEmotions: BigEmotion[];
  fineEmotions: FineEmotion[];
  records: EmotionRecord[];
  version: 1;
};

/* ======================= 手動同期関連 ======================= */

const LOCAL_KEY = "emotion_labeling_v1";
/**
 * DOC_KEYS:
 *   - user_docs 側の docKey を想定（例: "mental_emotion_labeling_v1"）
 *   - ホームの DOCS 配列には
 *       { docKey: "mental_emotion_labeling_v1", localKey: "emotion_labeling_v1" }
 *     を追加する想定です。
 */
const DOC_KEYS = ["mental_emotion_labeling_v1"] as const;

const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

/* ======================= ユーティリティ ======================= */

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

const now = () => Date.now();

/** JST の今日を "YYYY-MM-DD" に */
function todayJst(): string {
  const d = new Date();
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = p.find((x) => x.type === "year")!.value;
  const m = p.find((x) => x.type === "month")!.value;
  const da = p.find((x) => x.type === "day")!.value;
  return `${y}-${m}-${da}`;
}

/** ○時間○分○秒 表記（ms→） */
function fmtDuration(ms: number) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}時間${m}分${s}秒`;
}

/** targetSec(秒) → "mm:ss" 文字列（今回は合計表示用にだけ使用する想定） */
function formatMmSsFromSec(sec?: number): string {
  if (sec == null) return "";
  const t = Math.max(0, Math.round(sec));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/* ======================= localStorage 読み込み/保存 ======================= */

function loadLocal(): Store {
  try {
    if (typeof window === "undefined") {
      return { bigEmotions: [], fineEmotions: [], records: [], version: 1 };
    }
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) {
      // 初期値（ざっくり数個だけ用意）
      const t = now();
      const bigs: BigEmotion[] = [
        { id: uid(), name: "不安", createdAt: t },
        { id: uid(), name: "怒り", createdAt: t },
        { id: uid(), name: "悲しみ", createdAt: t },
        { id: uid(), name: "喜び", createdAt: t },
      ];
      const [anx, ang, sad, joy] = bigs;

      const fines: FineEmotion[] = [
        { id: uid(), bigId: anx.id, name: "焦る", createdAt: t },
        { id: uid(), bigId: anx.id, name: "落ち着かない", createdAt: t },
        { id: uid(), bigId: ang.id, name: "イライラする", createdAt: t },
        { id: uid(), bigId: sad.id, name: "落ち込む", createdAt: t },
        { id: uid(), bigId: joy.id, name: "うれしい", createdAt: t },
      ];

      return {
        bigEmotions: bigs,
        fineEmotions: fines,
        records: [],
        version: 1,
      };
    }

    const parsed = JSON.parse(raw) as Store;
    return {
      bigEmotions: parsed.bigEmotions ?? [],
      fineEmotions: parsed.fineEmotions ?? [],
      records: parsed.records ?? [],
      version: 1,
    };
  } catch {
    return { bigEmotions: [], fineEmotions: [], records: [], version: 1 };
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

/* ======================= コンポーネント本体 ======================= */

export default function EmotionLabeling() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);
  const [selectedDate, setSelectedDate] = useState<string>(() => todayJst());
  const [selectedBigId, setSelectedBigId] = useState<ID | null>(null);

  // store → localStorage 即時保存
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // ===== 手動同期（PULL/PUSH） =====
  const pullFromServer = async () => {
    for (const key of DOC_KEYS) {
      try {
        const remote = await loadUserDoc<Store>(key);
        if (remote && typeof remote === "object") {
          const normalized: Store = {
            bigEmotions: remote.bigEmotions ?? [],
            fineEmotions: remote.fineEmotions ?? [],
            records: remote.records ?? [],
            version: 1,
          };
          setStore(normalized);
          saveLocal(normalized);
          return;
        }
      } catch (e) {
        console.warn(`[emotion-labeling] PULL failed for docKey=${key}:`, e);
      }
    }
  };

  const pushToServer = async () => {
    const snapshot = storeRef.current;
    for (const key of DOC_KEYS) {
      try {
        await saveUserDoc<Store>(key, snapshot);
      } catch (e) {
        console.warn(`[emotion-labeling] PUSH failed for docKey=${key}:`, e);
      }
    }
  };

  // 手動同期の合図を購読
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = () => {
      void pullFromServer();
    };
    const doPush = () => {
      void pushToServer();
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
            // since 未使用なので noop
          } else if (
            t === LOCAL_APPLIED_TYPE &&
            msg.docKey &&
            DOC_KEYS.includes(msg.docKey)
          ) {
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
      else if (
        t === LOCAL_APPLIED_TYPE &&
        msg.docKey &&
        DOC_KEYS.includes(msg.docKey)
      ) {
        setStore(loadLocal());
      }
    };
    window.addEventListener("message", onWinMsg);

    const onStorage = (ev: StorageEvent) => {
      if (!ev.key) return;
      if (ev.key === LOCAL_KEY && ev.newValue) {
        try {
          const parsed = JSON.parse(ev.newValue) as Store;
          if (parsed && parsed.version === 1) {
            setStore(parsed);
          }
        } catch {
          // noop
        }
      }
      if (ev.key === STORAGE_KEY_RESET_REQ) {
        // noop（直後の PULL に期待）
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ======================= 各種 map や currentRecord ======================= */

  const bigMap = useMemo(
    () => new Map(store.bigEmotions.map((b) => [b.id, b] as const)),
    [store.bigEmotions]
  );
  const fineByBig = useMemo(() => {
    const m = new Map<ID, FineEmotion[]>();
    for (const f of store.fineEmotions) {
      if (!m.has(f.bigId)) m.set(f.bigId, []);
      m.get(f.bigId)!.push(f);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.createdAt - b.createdAt);
    }
    return m;
  }, [store.fineEmotions]);
  const fineMap = useMemo(
    () => new Map(store.fineEmotions.map((f) => [f.id, f] as const)),
    [store.fineEmotions]
  );

  // 最初の bigEmotion を自動選択
  useEffect(() => {
    if (!selectedBigId && store.bigEmotions.length > 0) {
      setSelectedBigId(store.bigEmotions[0].id);
    }
  }, [selectedBigId, store.bigEmotions]);

  const currentRecord: EmotionRecord | null = useMemo(() => {
    return (
      store.records.find((r) => r.date === selectedDate) ?? null
    );
  }, [store.records, selectedDate]);

  const totalIntensity = currentRecord
    ? currentRecord.labels.reduce((s, l) => s + (l.intensity || 0), 0)
    : 0;

  /* ======================= Record 更新ヘルパ ======================= */

  const upsertRecord = (
    updater: (prev: EmotionRecord | null) => EmotionRecord
  ) => {
    setStore((prev) => {
      const records = [...prev.records];
      const idx = records.findIndex((r) => r.date === selectedDate);
      const oldRec = idx >= 0 ? records[idx] : null;
      const newRec = updater(oldRec);
      if (idx >= 0) records[idx] = newRec;
      else records.push(newRec);
      return { ...prev, records };
    });
  };

  const ensureBaseRecord = (): EmotionRecord => {
    if (currentRecord) return currentRecord;
    const t = now();
    return {
      id: uid(),
      date: selectedDate,
      situation: "",
      labels: [],
      createdAt: t,
      updatedAt: t,
    };
  };

  /* ======================= ハンドラ ======================= */

  const handleDateChange = (val: string) => {
    setSelectedDate(val);
  };

  const handleSituationChange = (val: string) => {
    upsertRecord((old) => {
      const base = old ?? ensureBaseRecord();
      return {
        ...base,
        situation: val,
        updatedAt: now(),
      };
    });
  };

  const handleAddBigEmotion = () => {
    const name = prompt("新しい「大きな感情」の名前", "不安");
    if (!name) return;
    const t = now();
    const id = uid();
    setStore((prev) => ({
      ...prev,
      bigEmotions: [
        ...prev.bigEmotions,
        { id, name: name.trim(), createdAt: t },
      ],
    }));
    setSelectedBigId(id);
  };

  const handleAddFineEmotion = () => {
    if (!selectedBigId) {
      alert("先に「大きな感情」を選択してください。");
      return;
    }
    const big = bigMap.get(selectedBigId);
    const name = prompt(
      `「${big?.name ?? "感情"}」の中の細かい感情を追加`,
      "足搔く"
    );
    if (!name) return;
    const t = now();
    const fine: FineEmotion = {
      id: uid(),
      bigId: selectedBigId,
      name: name.trim(),
      createdAt: t,
    };
    setStore((prev) => ({
      ...prev,
      fineEmotions: [...prev.fineEmotions, fine],
    }));
  };

  const handleSelectFineEmotion = (fineId: ID) => {
    const fine = fineMap.get(fineId);
    if (!fine) return;

    upsertRecord((old) => {
      const base = old ?? ensureBaseRecord();
      const labels = [...base.labels];

      if (labels.find((l) => l.fineEmotionId === fineId)) {
        // すでに選択済みなら何もしない
        return base;
      }
      if (labels.length >= 3) {
        alert("選べる感情は最大3つまでです。");
        return base;
      }

      const currentSum = labels.reduce(
        (s, l) => s + (l.intensity || 0),
        0
      );
      // 新しく追加する感情には残りの％を自動で割り当て（0〜100）
      const remaining = Math.max(0, 100 - currentSum);
      const newIntensity =
        labels.length === 0 ? 100 : remaining; // 最初なら100%, それ以降は残り

      const nextLabels: EmotionLabel[] = [
        ...labels,
        {
          fineEmotionId: fineId,
          intensity: newIntensity,
        },
      ];

      return {
        ...base,
        labels: nextLabels,
        updatedAt: now(),
      };
    });
  };

  const handleChangeIntensity = (fineId: ID, val: string) => {
    const n = Number(val.replace(/[^0-9]/g, ""));
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;

    upsertRecord((old) => {
      const base = old ?? ensureBaseRecord();
      const nextLabels = base.labels.map((l) =>
        l.fineEmotionId === fineId
          ? { ...l, intensity: clamped }
          : l
      );
      return {
        ...base,
        labels: nextLabels,
        updatedAt: now(),
      };
    });
  };

  const handleRemoveLabel = (fineId: ID) => {
    upsertRecord((old) => {
      const base = old ?? ensureBaseRecord();
      const nextLabels = base.labels.filter(
        (l) => l.fineEmotionId !== fineId
      );
      return {
        ...base,
        labels: nextLabels,
        updatedAt: now(),
      };
    });
  };

  /* ======================= UI ======================= */

  const fineListForSelectedBig =
    selectedBigId != null ? fineByBig.get(selectedBigId) ?? [] : [];

  const selectedLabels: { fine: FineEmotion | null; label: EmotionLabel }[] =
    currentRecord
      ? currentRecord.labels.map((l) => ({
          fine: fineMap.get(l.fineEmotionId) ?? null,
          label: l,
        }))
      : [];

  return (
    <div className="space-y-4">
      {/* 日付 & 状況 */}
      <section className="rounded-2xl border p-4 shadow-sm space-y-3">
        <h2 className="font-semibold text-lg">感情ラベリング</h2>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-600">日付：</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => handleDateChange(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm"
          />
          {currentRecord && (
            <span className="text-xs text-gray-500">
              （この日の記録は保存済みです）
            </span>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">
            状況（何が起きていたか？）
          </label>
          <textarea
            value={currentRecord?.situation ?? ""}
            onChange={(e) => handleSituationChange(e.target.value)}
            className="w-full rounded-xl border px-3 py-2 text-sm min-h-[80px]"
            placeholder="例：明日の発表準備が終わっていないのに、時間がどんどん過ぎていった"
          />
          <p className="mt-1 text-xs text-gray-500">
            この状況の中で、どんな感情が動いていたかを、下でラベリングしていきます。
          </p>
        </div>
      </section>

      {/* 感情一覧（大きな感情 → 細かい感情） */}
      <section className="rounded-2xl border p-4 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">感情一覧</h3>
          <button
            onClick={handleAddBigEmotion}
            className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
          >
            大きな感情を追加
          </button>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          {/* 大きな感情リスト */}
          <div className="md:w-1/3">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">
              大きな感情
            </h4>
            {store.bigEmotions.length === 0 ? (
              <p className="text-xs text-gray-500">
                まだ感情がありません。「大きな感情を追加」から作成してください。
              </p>
            ) : (
              <ul className="space-y-1">
                {store.bigEmotions
                  .slice()
                  .sort((a, b) => a.createdAt - b.createdAt)
                  .map((b) => (
                    <li key={b.id}>
                      <button
                        className={`w-full text-left rounded-lg px-2 py-1 text-sm ${
                          selectedBigId === b.id
                            ? "bg-black text-white"
                            : "border hover:bg-gray-50"
                        }`}
                        onClick={() => setSelectedBigId(b.id)}
                      >
                        {b.name}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          {/* 細かい感情リスト */}
          <div className="md:w-2/3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-700">
                細かい感情
                {selectedBigId && bigMap.get(selectedBigId)
                  ? `（${bigMap.get(selectedBigId)!.name} の中）`
                  : ""}
              </h4>
              <button
                onClick={handleAddFineEmotion}
                className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
              >
                細かい感情を追加
              </button>
            </div>
            {selectedBigId == null ? (
              <p className="text-xs text-gray-500">
                左の「大きな感情」を選択すると、その中の細かい感情が表示されます。
              </p>
            ) : fineListForSelectedBig.length === 0 ? (
              <p className="text-xs text-gray-500">
                まだ細かい感情がありません。「細かい感情を追加」から作成してください。
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {fineListForSelectedBig.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => handleSelectFineEmotion(f.id)}
                    className="rounded-xl border px-3 py-2 text-xs text-left hover:bg-gray-50"
                    title="この感情をラベリング対象に追加（最大3つ）"
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-gray-500">
              例：「焦る」を選んだら、その中の「足搔く」「気が急く」などの
              細かい感情をここに追加していくイメージです。
            </p>
          </div>
        </div>
      </section>

      {/* 選択中の感情（最大3つ、100%割り振り） */}
      <section className="rounded-2xl border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">この状況で動いていた感情</h3>
          <span className="text-xs text-gray-500">
            最大3つまで選択し、合計が100％になるよう強度を調整します。
          </span>
        </div>

        {selectedLabels.length === 0 ? (
          <p className="text-sm text-gray-500">
            まだ感情が選ばれていません。上の「細かい感情」から、今の状況に近いものを選んでください。
          </p>
        ) : (
          <div className="space-y-2">
            {selectedLabels.map(({ fine, label }) => (
              <div
                key={label.fineEmotionId}
                className="flex items-center gap-3 border rounded-xl px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium break-words">
                    {fine?.name ?? "(削除された感情)"}
                  </div>
                  {fine && (
                    <div className="text-xs text-gray-500">
                      大きな感情：
                      {bigMap.get(fine.bigId)?.name ?? "（不明）"}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={label.intensity}
                    onChange={(e) =>
                      handleChangeIntensity(label.fineEmotionId, e.target.value)
                    }
                    className="w-16 rounded-lg border px-2 py-1 text-xs tabular-nums text-right"
                  />
                  <span className="text-xs text-gray-700">%</span>
                </div>
                <button
                  onClick={() => handleRemoveLabel(label.fineEmotionId)}
                  className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                  title="この感情をリストから外す"
                >
                  ×
                </button>
              </div>
            ))}

            <div className="flex items-center justify-between mt-2">
              <div className="text-xs text-gray-500">
                合計がちょうど 100％ になるように調整してください。
              </div>
              <div
                className={`text-xs font-semibold tabular-nums ${
                  totalIntensity === 100
                    ? "text-green-700"
                    : "text-red-600"
                }`}
              >
                合計: {totalIntensity}% / 100%
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
