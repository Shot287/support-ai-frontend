// src/features/mental/emotion-labeling.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

/* ========= 型 ========= */

// 大きな感情カテゴリ
type EmotionCategory = {
  id: ID;
  name: string;
  createdAt: number;
};

// 細かい感情（カテゴリの子）
type EmotionLeaf = {
  id: ID;
  parentId: ID;
  name: string;
  createdAt: number;
};

// 1つの状況で選んだ感情（最大3つ）
type SituationEmotionSelection = {
  leafId: ID;
  parentId: ID;
  leafName: string;
  parentName: string;
  intensity: number; // 0〜100。3つの合計が100になるように調整
};

type Situation = {
  id: ID;
  date: string; // "YYYY-MM-DD"
  context: string; // 状況説明
  emotions: SituationEmotionSelection[]; // 最大3つ
  createdAt: number;
  updatedAt: number;
};

type Store = {
  situations: Situation[];
  categories: EmotionCategory[];
  leaves: EmotionLeaf[];
  version: 1;
};

/* ========= 手動同期用 定数 ========= */
const LOCAL_KEY = "emotion_labeling_v1";
const DOC_KEYS = ["mental_emotion_labeling_v1"] as const;

const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

/* ========= ユーティリティ ========= */
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

const now = () => Date.now();

// JST 今日の日付 "YYYY-MM-DD"
function todayYmdJst(): string {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const da = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${da}`;
}

function fmtTime(t: number | null | undefined) {
  if (t == null) return "";
  return new Date(t).toLocaleTimeString("ja-JP", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ○時間○分○秒 表記 */
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}時間${m}分${sec}秒`;
}

/* ====== 初期感情データ ====== */

function createInitialEmotionData(): {
  categories: EmotionCategory[];
  leaves: EmotionLeaf[];
} {
  const t = now();

  const c1: EmotionCategory = { id: uid(), name: "不安・焦り", createdAt: t };
  const c2: EmotionCategory = { id: uid(), name: "怒り・イライラ", createdAt: t };
  const c3: EmotionCategory = { id: uid(), name: "悲しみ", createdAt: t };
  const c4: EmotionCategory = { id: uid(), name: "喜び・安心", createdAt: t };
  const categories = [c1, c2, c3, c4];

  const leaves: EmotionLeaf[] = [
    // 不安・焦り
    { id: uid(), parentId: c1.id, name: "不安", createdAt: t },
    { id: uid(), parentId: c1.id, name: "焦る", createdAt: t },
    { id: uid(), parentId: c1.id, name: "緊張する", createdAt: t },
    // 怒り・イライラ
    { id: uid(), parentId: c2.id, name: "イライラ", createdAt: t },
    { id: uid(), parentId: c2.id, name: "怒り", createdAt: t },
    { id: uid(), parentId: c2.id, name: "納得がいかない", createdAt: t },
    // 悲しみ
    { id: uid(), parentId: c3.id, name: "落ち込む", createdAt: t },
    { id: uid(), parentId: c3.id, name: "さびしい", createdAt: t },
    { id: uid(), parentId: c3.id, name: "がっかり", createdAt: t },
    // 喜び・安心
    { id: uid(), parentId: c4.id, name: "うれしい", createdAt: t },
    { id: uid(), parentId: c4.id, name: "ほっとする", createdAt: t },
    { id: uid(), parentId: c4.id, name: "ワクワクする", createdAt: t },
  ];

  return { categories, leaves };
}

/* ====== localStorage 読み込み/保存 ====== */

function loadLocal(): Store {
  try {
    if (typeof window === "undefined") {
      const seed = createInitialEmotionData();
      return {
        situations: [],
        categories: seed.categories,
        leaves: seed.leaves,
        version: 1,
      };
    }
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) {
      const seed = createInitialEmotionData();
      return {
        situations: [],
        categories: seed.categories,
        leaves: seed.leaves,
        version: 1,
      };
    }
    const parsed = JSON.parse(raw) as Partial<Store>;

    const seed = createInitialEmotionData();

    return {
      situations: parsed.situations ?? [],
      categories:
        parsed.categories && parsed.categories.length > 0
          ? parsed.categories
          : seed.categories,
      leaves:
        parsed.leaves && parsed.leaves.length > 0
          ? parsed.leaves
          : seed.leaves,
      version: 1,
    };
  } catch {
    const seed = createInitialEmotionData();
    return {
      situations: [],
      categories: seed.categories,
      leaves: seed.leaves,
      version: 1,
    };
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

/* ====== 強度（合計100％）調整ユーティリティ ====== */

/** n 個の要素に一様に 100 を配分（端数は先頭から +1） */
function distributeEven(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(100 / n);
  const rest = 100 - base * n;
  const arr = Array(n).fill(base);
  for (let i = 0; i < rest; i++) {
    arr[i] += 1;
  }
  return arr;
}

/**
 * スライダーで index の強度を newVal に変更したとき、
 * 他の要素をスケーリングして合計を100に保つ
 */
function rebalanceIntensities(
  intensities: number[],
  index: number,
  newVal: number
): number[] {
  const n = intensities.length;
  if (n === 0) return [];
  if (n === 1) return [100];

  newVal = Math.max(0, Math.min(100, Math.round(newVal)));

  const othersIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i !== index) othersIdx.push(i);
  }

  const remaining = Math.max(0, 100 - newVal);
  if (remaining === 0) {
    const res = Array(n).fill(0);
    res[index] = newVal;
    return res;
  }

  const currentOthersSum = othersIdx.reduce(
    (sum, i) => sum + Math.max(0, intensities[i]),
    0
  );

  const res = Array(n).fill(0);
  res[index] = newVal;

  if (currentOthersSum <= 0) {
    // 他が全部0なら均等配分
    const base = Math.floor(remaining / othersIdx.length);
    let rest = remaining - base * othersIdx.length;
    for (const i of othersIdx) {
      res[i] = base + (rest > 0 ? 1 : 0);
      if (rest > 0) rest -= 1;
    }
    return res;
  }

  // 比例配分
  let allocated = 0;
  for (let k = 0; k < othersIdx.length; k++) {
    const i = othersIdx[k];
    const ratio = intensities[i] / currentOthersSum;
    if (k === othersIdx.length - 1) {
      res[i] = remaining - allocated;
    } else {
      const v = Math.round(remaining * ratio);
      res[i] = v;
      allocated += v;
    }
  }

  // 念のため合計100を保証
  const sum = res.reduce((s, v) => s + v, 0);
  if (sum !== 100) {
    const diff = 100 - sum;
    const adjustIdx =
      othersIdx.length > 0 ? othersIdx[0] : index;
    res[adjustIdx] = Math.max(0, res[adjustIdx] + diff);
  }

  return res;
}

/* ========= 本体コンポーネント ========= */

export default function EmotionLabeling() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const [date, setDate] = useState<string>(() => todayYmdJst());
  const [selectedSituationId, setSelectedSituationId] = useState<ID | null>(
    null
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<ID | null>(null);

  // store → localStorage
  useEffect(() => {
    saveLocal(store);
  }, [store]);

  /* ====== サーバとの手動同期（簡易版） ====== */

  const pullFromServer = async () => {
    for (const key of DOC_KEYS) {
      try {
        const remote = await loadUserDoc<Store>(key);
        if (remote && typeof remote === "object") {
          const seed = createInitialEmotionData();
          const normalized: Store = {
            situations: remote.situations ?? [],
            categories:
              remote.categories && remote.categories.length > 0
                ? remote.categories
                : seed.categories,
            leaves:
              remote.leaves && remote.leaves.length > 0
                ? remote.leaves
                : seed.leaves,
            version: 1,
          };
          setStore(normalized);
          saveLocal(normalized);
          return;
        }
      } catch (e) {
        console.warn("[emotion-labeling] PULL failed", key, e);
      }
    }
  };

  const pushToServer = async () => {
    const snapshot = store;
    for (const key of DOC_KEYS) {
      try {
        await saveUserDoc<Store>(key, snapshot);
      } catch (e) {
        console.warn("[emotion-labeling] PUSH failed", key, e);
      }
    }
  };

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
          else if (
            t === LOCAL_APPLIED_TYPE &&
            msg.docKey &&
            (DOC_KEYS as readonly string[]).includes(msg.docKey)
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
        (DOC_KEYS as readonly string[]).includes(msg.docKey)
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
      } catch {
        // noop
      }
      window.removeEventListener("message", onWinMsg);
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ====== ビュー用の値 ====== */

  const situationsForDate = useMemo(
    () =>
      store.situations
        .filter((s) => s.date === date)
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt),
    [store.situations, date]
  );

  const selectedSituation =
    situationsForDate.find((s) => s.id === selectedSituationId) ??
    situationsForDate[0] ??
    null;

  // 選択中状況が変わったら ID を同期
  useEffect(() => {
    if (!selectedSituation && situationsForDate.length > 0) {
      setSelectedSituationId(situationsForDate[0].id);
    } else if (
      selectedSituation &&
      !situationsForDate.some((s) => s.id === selectedSituation.id)
    ) {
      // 別日付に変えたときなど
      if (situationsForDate.length > 0) {
        setSelectedSituationId(situationsForDate[0].id);
      } else {
        setSelectedSituationId(null);
      }
    }
  }, [selectedSituation, situationsForDate]);

  const categorySorted = useMemo(
    () => store.categories.slice().sort((a, b) => a.createdAt - b.createdAt),
    [store.categories]
  );

  const leavesByCategory = useMemo(() => {
    const map = new Map<ID, EmotionLeaf[]>();
    for (const leaf of store.leaves) {
      if (!map.has(leaf.parentId)) map.set(leaf.parentId, []);
      map.get(leaf.parentId)!.push(leaf);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.createdAt - b.createdAt);
    }
    return map;
  }, [store.leaves]);

  const activeCategoryId: ID | null =
    selectedCategoryId ?? categorySorted[0]?.id ?? null;

  // ★ EmotionLeaf[] に固定
  const leavesOfActiveCategory: EmotionLeaf[] = useMemo(() => {
    if (!activeCategoryId) return [];
    const arr = leavesByCategory.get(activeCategoryId);
    return arr ? arr.slice() : [];
  }, [activeCategoryId, leavesByCategory]);

  const totalIntensity =
    selectedSituation?.emotions.reduce((s, e) => s + e.intensity, 0) ?? 0;

  /* ====== 状況関連 ====== */

  const addSituation = () => {
    const id = uid();
    const nowMs = now();
    const newSituation: Situation = {
      id,
      date,
      context: "",
      emotions: [],
      createdAt: nowMs,
      updatedAt: nowMs,
    };
    setStore((prev) => ({
      ...prev,
      situations: [...prev.situations, newSituation],
    }));
    setSelectedSituationId(id);
  };

  const updateSituationContext = (id: ID, text: string) => {
    setStore((prev) => ({
      ...prev,
      situations: prev.situations.map((s) =>
        s.id === id ? { ...s, context: text, updatedAt: now() } : s
      ),
    }));
  };

  const deleteSituation = (id: ID) => {
    if (!confirm("この状況を削除しますか？（感情ラベルも消えます）")) return;
    setStore((prev) => {
      const next = prev.situations.filter((s) => s.id !== id);
      return { ...prev, situations: next };
    });
    if (selectedSituationId === id) {
      setSelectedSituationId(null);
    }
  };

  /* ====== 感情カテゴリ・細かい感情の編集 ====== */

  const addCategory = () => {
    const name = prompt(
      "追加する大きな感情（カテゴリ）名を入力してください。例：不安・焦り"
    );
    if (!name) return;
    const cat: EmotionCategory = {
      id: uid(),
      name: name.trim(),
      createdAt: now(),
    };
    setStore((prev) => ({
      ...prev,
      categories: [...prev.categories, cat],
    }));
    setSelectedCategoryId(cat.id);
  };

  const deleteCategory = (id: ID) => {
    if (
      !confirm(
        "このカテゴリを削除しますか？（パレットからは削除されますが、過去の記録はそのまま残ります）"
      )
    )
      return;
    setStore((prev) => ({
      ...prev,
      categories: prev.categories.filter((c) => c.id !== id),
      leaves: prev.leaves.filter((l) => l.parentId !== id),
    }));
    if (selectedCategoryId === id) {
      setSelectedCategoryId(null);
    }
  };

  const addLeaf = (parentId: ID) => {
    const cat = store.categories.find((c) => c.id === parentId);
    const name = prompt(
      `「${cat?.name ?? "カテゴリ"}」に追加する細かい感情を入力してください。例：足掻く`
    );
    if (!name) return;
    const leaf: EmotionLeaf = {
      id: uid(),
      parentId,
      name: name.trim(),
      createdAt: now(),
    };
    setStore((prev) => ({
      ...prev,
      leaves: [...prev.leaves, leaf],
    }));
  };

  const deleteLeaf = (leafId: ID) => {
    if (
      !confirm(
        "この細かい感情を削除しますか？（パレットからは削除されますが、過去の記録はそのまま残ります）"
      )
    )
      return;
    setStore((prev) => ({
      ...prev,
      leaves: prev.leaves.filter((l) => l.id !== leafId),
    }));
  };

  /* ====== 状況ごとの感情3つ＋強度（スライダー） ====== */

  const addEmotionToSituation = (leaf: EmotionLeaf) => {
    if (!selectedSituation) return;

    setStore((prev) => {
      const sit = prev.situations.find((s) => s.id === selectedSituation.id);
      if (!sit) return prev;

      // 既に3つ選んでいる場合は追加不可
      if (sit.emotions.length >= 3) {
        alert("選べる感情は最大3つまでです。");
        return prev;
      }
      // 同じ leaf が既に選択されている場合は何もしない
      if (sit.emotions.some((e) => e.leafId === leaf.id)) {
        return prev;
      }

      const parent =
        prev.categories.find((c) => c.id === leaf.parentId) ?? null;

      const newSelections: SituationEmotionSelection[] = [
        ...sit.emotions,
        {
          leafId: leaf.id,
          parentId: leaf.parentId,
          leafName: leaf.name,
          parentName: parent?.name ?? "",
          intensity: 0, // 後で調整
        },
      ];

      const n = newSelections.length;
      const dist = distributeEven(n);
      for (let i = 0; i < n; i++) {
        newSelections[i] = { ...newSelections[i], intensity: dist[i] };
      }

      const updated: Situation = {
        ...sit,
        emotions: newSelections,
        updatedAt: now(),
      };

      return {
        ...prev,
        situations: prev.situations.map((s) =>
          s.id === sit.id ? updated : s
        ),
      };
    });
  };

  const updateEmotionIntensity = (index: number, newVal: number) => {
    if (!selectedSituation) return;
    setStore((prev) => {
      const sit = prev.situations.find((s) => s.id === selectedSituation.id);
      if (!sit) return prev;
      if (index < 0 || index >= sit.emotions.length) return prev;

      const currentInts = sit.emotions.map((e) => e.intensity);
      const nextInts = rebalanceIntensities(currentInts, index, newVal);
      const newSelections = sit.emotions.map((e, i) => ({
        ...e,
        intensity: nextInts[i],
      }));

      const updated: Situation = {
        ...sit,
        emotions: newSelections,
        updatedAt: now(),
      };

      return {
        ...prev,
        situations: prev.situations.map((s) =>
          s.id === sit.id ? updated : s
        ),
      };
    });
  };

  const removeEmotionFromSituation = (index: number) => {
    if (!selectedSituation) return;
    setStore((prev) => {
      const sit = prev.situations.find((s) => s.id === selectedSituation.id);
      if (!sit) return prev;
      if (index < 0 || index >= sit.emotions.length) return prev;

      const rest = sit.emotions.filter((_, i) => i !== index);
      let newSelections = rest;
      if (rest.length > 0) {
        const dist = distributeEven(rest.length);
        newSelections = rest.map((e, i) => ({
          ...e,
          intensity: dist[i],
        }));
      }

      const updated: Situation = {
        ...sit,
        emotions: newSelections,
        updatedAt: now(),
      };

      return {
        ...prev,
        situations: prev.situations.map((s) =>
          s.id === sit.id ? updated : s
        ),
      };
    });
  };

  /* ========= UI ========= */

  return (
    <div className="space-y-4">
      {/* 上段：日付＋同期ボタン */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-lg">感情ラベリング</h2>
            <p className="text-xs text-gray-500 mt-1">
              その日の「状況」をいくつでも登録し、それぞれの場面で感じていた感情を
              3つまで、強度（合計100％）でラベリングします。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">日付:</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-xl border px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={() => addSituation()}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            >
              この日に新しい状況を追加
            </button>
            <button
              onClick={() => pullFromServer()}
              className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
              title="サーバから同期して最新データを取得"
            >
              📥 サーバから取得
            </button>
            <button
              onClick={() => pushToServer()}
              className="rounded-xl border px-3 py-2 text-xs hover:bg-gray-50"
              title="ローカルの内容をサーバに保存"
            >
              ☁ サーバに保存
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          同じ日付でも、授業・バイト・家庭…など複数の状況を登録できます。
        </p>
      </section>

      {/* 中段：左 = 状況一覧 / 右 = 選択中状況の編集 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* 左：状況一覧 */}
          <div className="lg:w-1/3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">
                {date} の状況一覧
              </h3>
              <span className="text-xs text-gray-500">
                {situationsForDate.length}件
              </span>
            </div>
            {situationsForDate.length === 0 ? (
              <p className="text-xs text-gray-500">
                この日付の状況はまだありません。「新しい状況を追加」を押してください。
              </p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {situationsForDate.map((s) => {
                  const firstEmotions = s.emotions
                    .map((e) => e.leafName)
                    .slice(0, 3)
                    .join("・");
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => setSelectedSituationId(s.id)}
                        className={`w-full text-left rounded-xl border px-3 py-2 text-xs ${
                          selectedSituation?.id === s.id
                            ? "border-blue-500 bg-blue-50"
                            : "hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex justify-between items-center gap-2">
                          <span className="font-semibold text-xs">
                            {s.context.trim()
                              ? s.context.trim().slice(0, 24) +
                                (s.context.trim().length > 24 ? "…" : "")
                              : "（内容未入力）"}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {fmtTime(s.createdAt)}
                          </span>
                        </div>
                        {firstEmotions && (
                          <p className="mt-1 text-[11px] text-gray-500">
                            感情: {firstEmotions}
                          </p>
                        )}
                      </button>
                      <div className="mt-1 flex justify-end">
                        <button
                          onClick={() => deleteSituation(s.id)}
                          className="rounded-lg border px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-50"
                        >
                          削除
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 右：選択中状況の編集 */}
          <div className="lg:flex-1 border-t pt-4 lg:border-t-0 lg:pt-0 lg:border-l lg:pl-4">
            {selectedSituation ? (
              <div className="space-y-4">
                {/* 状況テキスト */}
                <div>
                  <h3 className="font-semibold text-sm">状況の内容</h3>
                  <textarea
                    value={selectedSituation.context}
                    onChange={(e) =>
                      updateSituationContext(
                        selectedSituation.id,
                        e.target.value
                      )
                    }
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm min-h-[96px]"
                    placeholder="例：ゼミの発表で質問攻めにあって、頭が真っ白になった。"
                  />
                </div>

                {/* 感情 3つ＋強度 */}
                <div>
                  <h3 className="font-semibold text-sm">
                    この状況で感じた感情（最大3つ）
                  </h3>
                  {selectedSituation.emotions.length === 0 ? (
                    <p className="mt-1 text-xs text-gray-500">
                      下の「感情パレット」から細かい感情をクリックすると、ここに追加されます。
                    </p>
                  ) : (
                    <div className="mt-2 space-y-3">
                      {selectedSituation.emotions.map((e, i) => (
                        <div
                          key={`${e.leafId}-${i}`}
                          className="rounded-xl border px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-xs text-gray-500">
                                {e.parentName || "感情"}
                              </p>
                              <p className="text-sm font-semibold">
                                {e.leafName}
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                removeEmotionFromSituation(i)
                              }
                              className="rounded-lg border px-2 py-1 text-[11px] hover:bg-gray-50"
                            >
                              削除
                            </button>
                          </div>
                          <div className="mt-2 flex items-center gap-3">
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={e.intensity}
                              onChange={(ev) =>
                                updateEmotionIntensity(
                                  i,
                                  Number(ev.target.value)
                                )
                              }
                              className="flex-1"
                            />
                            <span className="w-12 text-right text-xs tabular-nums">
                              {e.intensity}%
                            </span>
                          </div>
                        </div>
                      ))}
                      <p className="text-xs text-gray-500 text-right">
                        合計: {totalIntensity}%
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                左の「状況一覧」から1つ選ぶか、「この日に新しい状況を追加」を押してください。
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 下段：感情パレット（大きな感情＋細かい感情の追加/削除＋選択） */}
      <section className="rounded-2xl border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">感情パレット</h3>
          <button
            onClick={addCategory}
            className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
          >
            大きな感情を追加
          </button>
        </div>
        <p className="text-xs text-gray-500">
          まず大きな感情（カテゴリ）を選び、その中の細かい感情をクリックすると、上の状況に追加されます（最大3つ）。
          感情パレット自体も好きなようにカスタマイズできます。
        </p>

        {categorySorted.length === 0 ? (
          <p className="text-xs text-gray-500 mt-2">
            感情カテゴリがありません。「大きな感情を追加」から作成してください。
          </p>
        ) : (
          <div className="space-y-3">
            {/* カテゴリタブ */}
            <div className="flex flex-wrap gap-2">
              {categorySorted.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center rounded-full border px-2 py-1 text-xs cursor-pointer ${
                    activeCategoryId === c.id
                      ? "border-blue-500 bg-blue-50"
                      : "hover:bg-gray-50"
                  }`}
                  onClick={() => setSelectedCategoryId(c.id)}
                >
                  <span>{c.name}</span>
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      deleteCategory(c.id);
                    }}
                    className="ml-1 rounded-full px-1 text-[10px] text-gray-500 hover:bg-white"
                    title="このカテゴリを削除（パレットのみ）"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {/* 細かい感情一覧 */}
            {activeCategoryId && (
              <div className="mt-1 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-600">
                    細かい感情（クリックで状況に追加）
                  </p>
                  <button
                    onClick={() => addLeaf(activeCategoryId)}
                    className="rounded-xl border px-2 py-1 text-[11px] hover:bg-gray-50"
                  >
                    細かい感情を追加
                  </button>
                </div>
                {leavesOfActiveCategory.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    まだ細かい感情がありません。「細かい感情を追加」から作成してください。
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {leavesOfActiveCategory.map((leaf: EmotionLeaf) => (
                      <div
                        key={leaf.id}
                        className="flex items-center gap-1 rounded-full border px-2 py-1 text-xs bg-white"
                      >
                        <button
                          className="hover:underline"
                          onClick={() => addEmotionToSituation(leaf)}
                          title="この感情を選択中の状況に追加"
                        >
                          {leaf.name}
                        </button>
                        <button
                          onClick={() => deleteLeaf(leaf.id)}
                          className="rounded-full px-1 text-[10px] text-gray-500 hover:bg-gray-50"
                          title="パレットから削除"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
