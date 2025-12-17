// src/features/study/sapuri-part2.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

type ChoiceKey = "A" | "B" | "C";

type Choice = {
  key: ChoiceKey;
  text?: string; // 英文（読み上げ対象）
  ja?: string; // 日本語（表示用）
  audioUrl?: string; // 互換用（使わない）
};

type Part2Question = {
  id: ID;
  qText?: string; // 英文（読み上げ対象）
  qJa?: string; // 日本語（表示用）
  qAudioUrl?: string; // 互換用（使わない）
  choices: Choice[];
  correct: ChoiceKey;
  explanation?: string;
  speaker?: { q?: string; a?: string };
};

type StoreV1 = {
  version: 1;
  updatedAt: number;
  questions: Part2Question[];
  settings: {
    autoplaySequence: boolean; // 問題→A→B→C を自動再生
    showEnglish: boolean; // 英文表示
    showJapanese: boolean; // 日本語表示
    // legacy
    showText?: boolean;
  };
  progress: {
    currentIndex: number;
    lastAnswered?: {
      qid: ID;
      selected: ChoiceKey;
      correct: boolean;
      answeredAt: number;
    };
  };
};

const LOCAL_KEY = "study_sapuri_part2_v1";
const DOC_KEY = "study_sapuri_part2_v1";

const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function normalizeChoiceKey(k: any): ChoiceKey | null {
  const s = String(k ?? "").trim().toUpperCase();
  if (s === "A" || s === "B" || s === "C") return s;
  return null;
}

function migrate(raw: any): StoreV1 {
  // デフォルト：英文ON / 日本語OFF（リスニング向け）
  const base: StoreV1 = {
    version: 1,
    updatedAt: Date.now(),
    questions: [],
    settings: { autoplaySequence: true, showEnglish: true, showJapanese: false },
    progress: { currentIndex: 0 },
  };

  if (!raw || typeof raw !== "object") return base;
  if (raw.version !== 1) return base;

  const qArr = Array.isArray(raw.questions) ? raw.questions : [];
  const questions: Part2Question[] = qArr
    .map((q: any) => {
      const id = typeof q.id === "string" && q.id ? q.id : uid();
      const correct = normalizeChoiceKey(q.correct) ?? "A";

      const choicesRaw = Array.isArray(q.choices) ? q.choices : [];
      const choices: Choice[] = choicesRaw
        .map((c: any) => {
          const key = normalizeChoiceKey(c?.key);
          if (!key) return null;
          const text = typeof c.text === "string" ? c.text : undefined;
          const ja = typeof c.ja === "string" ? c.ja : undefined;
          const audioUrl = typeof c.audioUrl === "string" ? c.audioUrl : undefined;
          return { key, text, ja, audioUrl } as Choice;
        })
        .filter(Boolean) as Choice[];

      // A/B/Cが足りない場合は補完
      const byKey = new Map<ChoiceKey, Choice>();
      for (const c of choices) byKey.set(c.key, c);
      (["A", "B", "C"] as ChoiceKey[]).forEach((k) => {
        if (!byKey.has(k)) byKey.set(k, { key: k });
      });

      return {
        id,
        qText: typeof q.qText === "string" ? q.qText : undefined,
        qJa: typeof q.qJa === "string" ? q.qJa : undefined,
        qAudioUrl: typeof q.qAudioUrl === "string" ? q.qAudioUrl : undefined,
        choices: (["A", "B", "C"] as ChoiceKey[]).map((k) => byKey.get(k)!),
        correct,
        explanation: typeof q.explanation === "string" ? q.explanation : undefined,
        speaker:
          q.speaker && typeof q.speaker === "object"
            ? {
                q: typeof q.speaker.q === "string" ? q.speaker.q : undefined,
                a: typeof q.speaker.a === "string" ? q.speaker.a : undefined,
              }
            : undefined,
      } as Part2Question;
    })
    .filter(Boolean);

  const settings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
  const progress = raw.progress && typeof raw.progress === "object" ? raw.progress : {};

  const legacyShowText = typeof settings.showText === "boolean" ? settings.showText : undefined;

  const merged: StoreV1 = {
    version: 1,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
    questions,
    settings: {
      autoplaySequence:
        typeof settings.autoplaySequence === "boolean"
          ? settings.autoplaySequence
          : base.settings.autoplaySequence,
      showEnglish:
        typeof settings.showEnglish === "boolean"
          ? settings.showEnglish
          : legacyShowText ?? base.settings.showEnglish,
      showJapanese:
        typeof settings.showJapanese === "boolean"
          ? settings.showJapanese
          : base.settings.showJapanese,
      showText: legacyShowText,
    },
    progress: {
      currentIndex:
        typeof progress.currentIndex === "number" ? Math.max(0, progress.currentIndex) : 0,
      lastAnswered:
        progress.lastAnswered && typeof progress.lastAnswered === "object"
          ? {
              qid: typeof progress.lastAnswered.qid === "string" ? progress.lastAnswered.qid : "",
              selected: (normalizeChoiceKey(progress.lastAnswered.selected) ?? "A") as ChoiceKey,
              correct: !!progress.lastAnswered.correct,
              answeredAt:
                typeof progress.lastAnswered.answeredAt === "number"
                  ? progress.lastAnswered.answeredAt
                  : Date.now(),
            }
          : undefined,
    },
  };

  if (merged.questions.length === 0) merged.progress.currentIndex = 0;
  else merged.progress.currentIndex = Math.min(merged.progress.currentIndex, merged.questions.length - 1);

  return merged;
}

function loadLocal(): StoreV1 {
  try {
    const s = localStorage.getItem(LOCAL_KEY);
    if (!s) return migrate(null);
    return migrate(JSON.parse(s));
  } catch {
    return migrate(null);
  }
}

function saveLocal(store: StoreV1) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

/** 英文のみ読み上げ（Web Speech API） */
async function speakEnglish(text: string) {
  if (typeof window === "undefined") return;

  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
    throw new Error("speechSynthesis not supported");
  }

  try {
    synth.cancel();
  } catch {}

  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";

  return new Promise<void>((resolve, reject) => {
    u.onend = () => resolve();
    u.onerror = () => reject(new Error("tts error"));
    try {
      synth.speak(u);
    } catch (e) {
      reject(e);
    }
  });
}

function labelSpeakText(key: ChoiceKey, english: string) {
  return `${key}. ${english}`;
}

function normQuestionKey(qText?: string) {
  const s = (qText ?? "").trim().replace(/\s+/g, " ");
  return s.toLowerCase();
}

/* =========================
   ✅ ディクテーションUI（点灯だけ）
   - wrongTick を「増やす」→ UIは wrongFlashId と一致した瞬間だけ赤にする
   - さらに setTimeout で wrongFlashId を0に戻し「一瞬だけ点灯」させる
   ========================= */

type DictFieldKey = "Q" | "A" | "B" | "C";

function buildSlots(text: string) {
  return Array.from(text);
}
function isAlphabet(ch: string) {
  return /^[A-Za-z]$/.test(ch);
}
function applyCaseToMatch(correct: string, typed: string) {
  return correct === correct.toUpperCase() ? typed.toUpperCase() : typed.toLowerCase();
}
function initDictStateForText(text?: string) {
  const t = (text ?? "").toString();
  const slots = buildSlots(t);
  const values = slots.map((ch) => (isAlphabet(ch) ? "" : ch));
  let next = 0;
  while (next < slots.length && !isAlphabet(slots[next])) next++;
  return { values, nextIndex: next, done: slots.length === 0 };
}

export default function SapuriPart2() {
  const [store, setStore] = useState<StoreV1>(() => {
    if (typeof window === "undefined") return migrate(null);
    return loadLocal();
  });
  const storeRef = useRef(store);

  const q = useMemo(() => {
    const list = store.questions;
    if (!list.length) return null;
    const i = Math.min(store.progress.currentIndex, list.length - 1);
    return list[i];
  }, [store.questions, store.progress.currentIndex]);

  const [selected, setSelected] = useState<ChoiceKey | null>(null);
  const [result, setResult] = useState<null | { correct: boolean; correctKey: ChoiceKey }>(null);
  const [busy, setBusy] = useState(false);

  // ペースト用UI
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);

  // 一覧 表示
  const [showList, setShowList] = useState(true);

  // ✅ ディクテーション状態（Q/A/B/C それぞれ）
  const [dict, setDict] = useState<{
    Q: ReturnType<typeof initDictStateForText>;
    A: ReturnType<typeof initDictStateForText>;
    B: ReturnType<typeof initDictStateForText>;
    C: ReturnType<typeof initDictStateForText>;
  }>(() => ({
    Q: initDictStateForText(""),
    A: initDictStateForText(""),
    B: initDictStateForText(""),
    C: initDictStateForText(""),
  }));

  // ✅ 行ごとの入力キャプチャを「有効化」するためのフォーカス先
  const dictRowRef = useRef<{ [K in DictFieldKey]?: HTMLDivElement | null }>({});
  const [activeDictRow, setActiveDictRow] = useState<DictFieldKey>("Q");

  // ✅ 「赤点灯」を一瞬だけ出すためのフラッシュ状態
  // - fieldごとに flashId を持つ（増えるたびに点灯）
  const [wrongFlashId, setWrongFlashId] = useState<Record<DictFieldKey, number>>({
    Q: 0,
    A: 0,
    B: 0,
    C: 0,
  });
  const wrongTimerRef = useRef<Record<DictFieldKey, number | null>>({
    Q: null,
    A: null,
    B: null,
    C: null,
  });

  const flashWrongOnce = (field: DictFieldKey) => {
    // 既存タイマーがあれば消して「今回の点灯」に置き換える
    const prev = wrongTimerRef.current[field];
    if (prev) window.clearTimeout(prev);

    setWrongFlashId((m) => {
      const next = (m[field] ?? 0) + 1;
      return { ...m, [field]: next };
    });

    // 120ms後に0に戻して消灯（「一度点灯」）
    wrongTimerRef.current[field] = window.setTimeout(() => {
      setWrongFlashId((m) => ({ ...m, [field]: 0 }));
      wrongTimerRef.current[field] = null;
    }, 120);
  };

  // ローカルへ即時保存
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // 手動同期購読（PULL/PUSH/LOCAL_DOC_APPLIED/storage）
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<StoreV1>(DOC_KEY);
        if (remote && remote.version === 1) {
          const m = migrate(remote);
          setStore(m);
          saveLocal(m);
        }
      } catch (e) {
        console.warn("[sapuri-part2] manual PULL failed:", e);
      }
    };

    const doPush = async () => {
      try {
        await saveUserDoc<StoreV1>(DOC_KEY, storeRef.current);
      } catch (e) {
        console.warn("[sapuri-part2] manual PUSH failed:", e);
      }
    };

    let bc: BroadcastChannel | null = null;
    try {
      if ("BroadcastChannel" in window) {
        bc = new BroadcastChannel(SYNC_CHANNEL);
        bc.onmessage = (ev) => {
          const msg = (ev as any)?.data;
          if (!msg || typeof msg.type !== "string") return;
          const t = msg.type.toUpperCase();
          if (t.includes("PULL")) doPull();
          else if (t.includes("PUSH")) doPush();
          else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            setStore(loadLocal());
          }
        };
      }
    } catch {}

    const onWinMsg = (ev: MessageEvent) => {
      const msg: any = ev?.data;
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
        } catch {}
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

  // 問題切り替え時に表示状態をリセット + TTS停止 + ディクテーション初期化
  useEffect(() => {
    setSelected(null);
    setResult(null);
    try {
      window.speechSynthesis?.cancel();
    } catch {}

    const qText = q?.qText ?? "";
    const aText = q?.choices.find((x) => x.key === "A")?.text ?? "";
    const bText = q?.choices.find((x) => x.key === "B")?.text ?? "";
    const cText = q?.choices.find((x) => x.key === "C")?.text ?? "";

    setDict({
      Q: initDictStateForText(qText),
      A: initDictStateForText(aText),
      B: initDictStateForText(bText),
      C: initDictStateForText(cText),
    });

    setActiveDictRow("Q");

    // ✅ フラッシュ状態もリセット
    setWrongFlashId({ Q: 0, A: 0, B: 0, C: 0 });
    (["Q", "A", "B", "C"] as DictFieldKey[]).forEach((k) => {
      const t = wrongTimerRef.current[k];
      if (t) window.clearTimeout(t);
      wrongTimerRef.current[k] = null;
    });
  }, [q?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ✅ アクティブ行が変わったら、その行にフォーカス
  useEffect(() => {
    const el = dictRowRef.current[activeDictRow];
    try {
      el?.focus();
    } catch {}
  }, [activeDictRow, dict.Q.nextIndex, dict.A.nextIndex, dict.B.nextIndex, dict.C.nextIndex]);

  const canPlay = !!q;

  const playQuestion = async () => {
    if (!q) return;
    const t = q.qText?.trim() || "";
    if (!t) return;
    await speakEnglish(t);
  };

  const playChoiceAny = async (key: ChoiceKey) => {
    if (!q) return;
    const c = q.choices.find((x) => x.key === key);
    if (!c) return;
    const t = c.text?.trim() || "";
    if (!t) return;
    await speakEnglish(labelSpeakText(key, t));
  };

  const playSequence = async () => {
    if (!q) return;
    setBusy(true);
    try {
      await playQuestion();
      for (const c of q.choices) {
        await playChoiceAny(c.key);
      }
    } catch (e) {
      console.warn("playSequence failed:", e);
    } finally {
      setBusy(false);
    }
  };

  const playQuestionOnly = async () => {
    if (!q) return;
    setBusy(true);
    try {
      await playQuestion();
    } catch (e) {
      console.warn("playQuestionOnly failed:", e);
    } finally {
      setBusy(false);
    }
  };

  const playChoice = async (key: ChoiceKey) => {
    if (!q) return;
    setBusy(true);
    try {
      await playChoiceAny(key);
    } catch (e) {
      console.warn("playChoice failed:", e);
    } finally {
      setBusy(false);
    }
  };

  const answer = (key: ChoiceKey) => {
    if (!q) return;
    setSelected(key);
    const ok = key === q.correct;
    setResult({ correct: ok, correctKey: q.correct });

    setStore((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      progress: {
        ...prev.progress,
        lastAnswered: {
          qid: q.id,
          selected: key,
          correct: ok,
          answeredAt: Date.now(),
        },
      },
    }));
  };

  const next = () => {
    setStore((prev) => {
      const n = prev.questions.length;
      if (!n) return prev;
      const ni = Math.min(prev.progress.currentIndex + 1, n - 1);
      return { ...prev, updatedAt: Date.now(), progress: { ...prev.progress, currentIndex: ni } };
    });
  };

  const prevQ = () => {
    setStore((prev) => {
      const ni = Math.max(prev.progress.currentIndex - 1, 0);
      return { ...prev, updatedAt: Date.now(), progress: { ...prev.progress, currentIndex: ni } };
    });
  };

  const toggleSetting = (k: keyof StoreV1["settings"]) => {
    setStore((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      settings: { ...prev.settings, [k]: !prev.settings[k] },
    }));
  };

  // 一覧からジャンプ
  const goToIndex = (i: number) => {
    setStore((prev) => {
      const n = prev.questions.length;
      if (!n) return prev;
      const ni = Math.max(0, Math.min(i, n - 1));
      return { ...prev, updatedAt: Date.now(), progress: { ...prev.progress, currentIndex: ni } };
    });
  };

  // 一覧から削除（番号は自動で詰まる）
  const deleteAt = (i: number) => {
    setStore((prev) => {
      const n = prev.questions.length;
      if (i < 0 || i >= n) return prev;

      const nextQuestions = prev.questions.slice();
      const deleted = nextQuestions.splice(i, 1)[0];

      let nextIndex = prev.progress.currentIndex;
      if (i < nextIndex) nextIndex = Math.max(0, nextIndex - 1);
      if (nextIndex >= nextQuestions.length) nextIndex = Math.max(0, nextQuestions.length - 1);

      const lastAnswered =
        prev.progress.lastAnswered?.qid && prev.progress.lastAnswered.qid === deleted?.id
          ? undefined
          : prev.progress.lastAnswered;

      return {
        ...prev,
        updatedAt: Date.now(),
        questions: nextQuestions,
        progress: { ...prev.progress, currentIndex: nextIndex, lastAnswered },
      };
    });
  };

  // インポート：既存に「追記」＋ 同じ問題文(qText)を重複スキップ
  const applyImported = (parsed: any) => {
    const incoming = Array.isArray(parsed) ? { version: 1, questions: parsed } : parsed;
    const m = migrate(incoming);

    setStore((prev) => {
      const existingKeys = new Set<string>();
      for (const qq of prev.questions) {
        const k = normQuestionKey(qq.qText);
        if (k) existingKeys.add(k);
      }

      let added = 0;
      let skipped = 0;
      const mergedQuestions = prev.questions.slice();

      for (const qq of m.questions) {
        const k = normQuestionKey(qq.qText);
        if (k && existingKeys.has(k)) {
          skipped++;
          continue;
        }
        if (k) existingKeys.add(k);
        mergedQuestions.push(qq);
        added++;
      }

      const nextIndex =
        prev.questions.length === 0 && mergedQuestions.length > 0
          ? 0
          : Math.min(prev.progress.currentIndex, Math.max(0, mergedQuestions.length - 1));

      setImportInfo(`インポート完了：追加 ${added} 件 / 重複スキップ ${skipped} 件`);
      return {
        ...prev,
        updatedAt: Date.now(),
        questions: mergedQuestions,
        progress: { ...prev.progress, currentIndex: nextIndex },
      };
    });
  };

  const onImportJson = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      applyImported(parsed);
      setImportError(null);
    } catch (e) {
      alert("JSONの読み込みに失敗しました。形式を確認してください。");
      console.warn(e);
    }
  };

  const importFromText = () => {
    const raw = importText.trim();
    if (!raw) {
      setImportError("JSONが空です。貼り付けてください。");
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      applyImported(parsed);
      setImportError(null);
      setImportText("");
    } catch (e) {
      setImportError("JSONの解析に失敗しました（カンマ/括弧/引用符などを確認）。");
      console.warn(e);
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sapuri_part2_store.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const total = store.questions.length;
  const idx = total ? store.progress.currentIndex + 1 : 0;

  const showEn = !!store.settings.showEnglish;
  const showJa = !!store.settings.showJapanese;

  // ✅ 1文字トライ（正解なら進む／不正なら「点灯だけ」）
  const tryDictChar = (field: DictFieldKey, typed: string) => {
    if (!q) return;

    const correctText =
      field === "Q"
        ? q.qText ?? ""
        : q.choices.find((x) => x.key === field)?.text ?? "";

    const slots = buildSlots(correctText);
    if (!slots.length) return;

    const t = (typed ?? "").slice(-1);
    if (!t || !isAlphabet(t)) return;

    const cur = dict[field];
    let ni = cur.nextIndex;
    while (ni < slots.length && !isAlphabet(slots[ni])) ni++;
    if (ni >= slots.length) return;

    const correctChar = slots[ni];
    if (t.toLowerCase() !== correctChar.toLowerCase()) {
      // ❌ 間違い：その都度「一瞬だけ」赤点灯
      flashWrongOnce(field);
      return;
    }

    // ✅ 正解：埋めて進める
    setDict((prev) => {
      const cur2 = prev[field];
      const nextValues = cur2.values.slice();
      nextValues[ni] = applyCaseToMatch(correctChar, t);

      let next = ni + 1;
      while (next < slots.length && !isAlphabet(slots[next])) next++;
      const done = next >= slots.length;

      return {
        ...prev,
        [field]: { ...cur2, values: nextValues, nextIndex: next, done },
      };
    });
  };

  // ✅ 行（Q/A/B/C）をアクティブにして連続入力：キー入力を行コンテナで拾う
  const onDictRowKeyDown = (field: DictFieldKey, e: React.KeyboardEvent<HTMLDivElement>) => {
    if (busy) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key && e.key.length === 1) {
      const ch = e.key;
      if (isAlphabet(ch)) {
        e.preventDefault();
        setActiveDictRow(field);
        tryDictChar(field, ch);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveDictRow((prev) => (prev === "Q" ? "A" : prev === "A" ? "B" : prev === "B" ? "C" : "C"));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveDictRow((prev) => (prev === "C" ? "B" : prev === "B" ? "A" : prev === "A" ? "Q" : "Q"));
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
    }
  };

  const resetDictField = (field: DictFieldKey) => {
    if (!q) return;
    const text =
      field === "Q"
        ? q.qText ?? ""
        : q.choices.find((x) => x.key === field)?.text ?? "";
    setDict((prev) => ({ ...prev, [field]: initDictStateForText(text) }));
    setActiveDictRow(field);
    setWrongFlashId((m) => ({ ...m, [field]: 0 }));
  };

  const resetAllDict = () => {
    if (!q) return;
    const qText = q.qText ?? "";
    const aText = q.choices.find((x) => x.key === "A")?.text ?? "";
    const bText = q.choices.find((x) => x.key === "B")?.text ?? "";
    const cText = q.choices.find((x) => x.key === "C")?.text ?? "";
    setDict({
      Q: initDictStateForText(qText),
      A: initDictStateForText(aText),
      B: initDictStateForText(bText),
      C: initDictStateForText(cText),
    });
    setActiveDictRow("Q");
    setWrongFlashId({ Q: 0, A: 0, B: 0, C: 0 });
  };

  const renderDictRow = (label: string, field: DictFieldKey) => {
    if (!q) return null;

    const correctText =
      field === "Q"
        ? q.qText ?? ""
        : q.choices.find((x) => x.key === field)?.text ?? "";
    const state = dict[field];
    const slots = buildSlots(correctText);

    if (!correctText.trim()) {
      return (
        <div className="text-sm text-gray-500">
          {label}: (textなし)
        </div>
      );
    }

    const isActive = activeDictRow === field;
    const flashOn = isActive && (wrongFlashId[field] ?? 0) > 0; // ✅ 0に戻るので「点灯だけ」になる

    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">{label}</div>
          <button className="px-2 py-1 rounded border text-xs" onClick={() => resetDictField(field)} disabled={busy}>
            リセット
          </button>
          <div className="text-xs text-gray-500">
            {state.done ? "完了" : `次: ${state.nextIndex + 1}/${slots.length}`}
          </div>
          {isActive && <div className="text-xs text-gray-500">（この行にそのまま タイピングOK）</div>}
        </div>

        <div
          ref={(el) => {
            dictRowRef.current[field] = el;
          }}
          tabIndex={0}
          onFocus={() => setActiveDictRow(field)}
          onMouseDown={() => setActiveDictRow(field)}
          onKeyDown={(e) => onDictRowKeyDown(field, e)}
          className={
            "rounded border p-2 outline-none transition-colors " +
            (isActive ? "ring-2 ring-gray-400" : "") +
            (flashOn ? " ring-red-400 border-red-400" : "")
          }
          title="クリックしてもOKですが、以後はクリック無しで入力できます（この枠がフォーカスを持ちます）"
        >
          <div className="flex flex-wrap items-center gap-1">
            {slots.map((ch, i) => {
              if (!isAlphabet(ch)) {
                return (
                  <span key={i} className="px-1 text-sm text-gray-600 whitespace-pre">
                    {ch}
                  </span>
                );
              }
              const v = state.values[i] || "";
              const isNext = i === state.nextIndex;

              // ✅ 点灯は「次の枠」だけに出す（行全体も軽く赤）
              const showFlash = flashOn && isNext;

              return (
                <div
                  key={i}
                  className={
                    "w-7 h-8 flex items-center justify-center border rounded text-sm font-mono select-none transition-colors " +
                    (isNext ? "ring-2 ring-gray-400" : "") +
                    (showFlash ? " border-red-500 ring-red-500" : "")
                  }
                  title={isNext ? "次に入力する枠" : ""}
                >
                  {v ? v : "_"}
                </div>
              );
            })}
          </div>
        </div>

        {isActive && (
          <div className="text-xs text-gray-500">
            ※ 英字キーを押すと自動で次に進みます。間違うと「一瞬だけ」赤く点灯します。
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">スタディサプリ対応 Part2</h1>
        <div className="flex items-center gap-2 text-sm">
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => onImportJson(e.target.files?.[0] ?? null)}
            />
            <span className="px-3 py-1 rounded border">JSONインポート</span>
          </label>
          <button className="px-3 py-1 rounded border" onClick={exportJson}>
            JSONエクスポート
          </button>
        </div>
      </div>

      {/* 問題一覧（ジャンプ/削除） */}
      <div className="rounded border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">問題一覧（英文のみ）</div>
          <button className="px-3 py-1 rounded border text-sm" onClick={() => setShowList((v) => !v)}>
            {showList ? "一覧を閉じる" : "一覧を開く"}
          </button>
        </div>

        {showList && (
          <div className="rounded border overflow-auto" style={{ maxHeight: 280 }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b">
                  <th className="p-2 text-left w-16">No</th>
                  <th className="p-2 text-left">Question</th>
                  <th className="p-2 text-left w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {store.questions.length === 0 ? (
                  <tr>
                    <td className="p-2 text-gray-500" colSpan={3}>
                      まだ問題がありません（JSONをインポートしてください）
                    </td>
                  </tr>
                ) : (
                  store.questions.map((qq, i) => {
                    const active = i === store.progress.currentIndex;
                    return (
                      <tr key={qq.id} className={active ? "border-b bg-gray-50" : "border-b"}>
                        <td className="p-2">{i + 1}</td>
                        <td className="p-2">
                          <div className="truncate" title={qq.qText ?? ""}>
                            {qq.qText?.trim() ? qq.qText : <span className="text-gray-400">(qTextなし)</span>}
                          </div>
                        </td>
                        <td className="p-2 flex gap-2">
                          <button className="px-2 py-1 rounded border" onClick={() => goToIndex(i)} disabled={busy}>
                            移動
                          </button>
                          <button
                            className="px-2 py-1 rounded border"
                            onClick={() => {
                              if (confirm(`No.${i + 1} を削除しますか？`)) deleteAt(i);
                            }}
                            disabled={busy}
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-xs text-gray-500">
          ※ 番号は「追加順（配列順）」で自動採番です。削除すると自動で詰まります。
        </div>
      </div>

      {/* ペーストインポート */}
      <div className="rounded border p-3 space-y-2">
        <div className="text-sm font-semibold">JSONをペーストしてインポート（追記＋重複スキップ）</div>
        <textarea
          className="w-full rounded border p-2 text-sm font-mono"
          rows={6}
          placeholder='ここにJSONを貼り付け → 「ペーストインポート」を押す
例: { "version": 1, "questions": [...] }'
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button className="px-3 py-1 rounded border" onClick={importFromText}>
            ペーストインポート
          </button>
          <button
            className="px-3 py-1 rounded border"
            onClick={() => {
              setImportText("");
              setImportError(null);
              setImportInfo(null);
            }}
          >
            クリア
          </button>
          {importError && <div className="text-sm text-red-700">{importError}</div>}
          {importInfo && <div className="text-sm text-green-700">{importInfo}</div>}
        </div>
      </div>

      {/* 設定バー */}
      <div className="rounded border p-3 text-sm flex flex-wrap gap-3 items-center">
        <button className="px-3 py-1 rounded border" onClick={() => toggleSetting("autoplaySequence")}>
          自動再生: {store.settings.autoplaySequence ? "ON" : "OFF"}
        </button>

        <button className="px-3 py-1 rounded border" onClick={() => toggleSetting("showEnglish")}>
          英文表示: {showEn ? "ON" : "OFF"}
        </button>

        <button className="px-3 py-1 rounded border" onClick={() => toggleSetting("showJapanese")}>
          日本語表示: {showJa ? "ON" : "OFF"}
        </button>

        <div className="ml-auto text-gray-600">{total ? `${idx}/${total}` : "問題がありません（JSONをインポートしてください）"}</div>
      </div>

      <div className="rounded border p-4 space-y-3">
        <div className="flex gap-2 flex-wrap">
          <button
            className="px-3 py-2 rounded border disabled:opacity-50"
            disabled={!canPlay || busy}
            onClick={() => {
              if (!q) return;
              if (store.settings.autoplaySequence) playSequence();
              else playQuestionOnly();
            }}
          >
            ▶ 再生（問題{store.settings.autoplaySequence ? "→A→B→C" : ""}）
          </button>

          <button className="px-3 py-2 rounded border disabled:opacity-50" disabled={!q || busy} onClick={prevQ}>
            ← 前へ
          </button>
          <button className="px-3 py-2 rounded border disabled:opacity-50" disabled={!q || busy} onClick={next}>
            次へ →
          </button>
        </div>

        {/* 問題文表示（英文/日本語） */}
        {q && (
          <div className="space-y-1">
            {showEn ? (
              q.qText ? (
                <div className="text-base font-medium">{q.qText}</div>
              ) : (
                <div className="text-base text-gray-400">(qTextなし)</div>
              )
            ) : null}

            {showJa ? (q.qJa ? <div className="text-gray-700">{q.qJa}</div> : null) : null}

            {(q.speaker?.q || q.speaker?.a) && (
              <div className="text-xs text-gray-500">
                {q.speaker?.q ? `Q: ${q.speaker.q}` : ""}
                {q.speaker?.q && q.speaker?.a ? " / " : ""}
                {q.speaker?.a ? `A: ${q.speaker.a}` : ""}
              </div>
            )}

            {!showEn && !showJa && (
              <div className="text-xs text-gray-500">※ 英文/日本語どちらも非表示です（リスニング専用モード）</div>
            )}
          </div>
        )}

        {/* 3択 */}
        {q && (
          <div className="space-y-2">
            {q.choices.map((c) => {
              const isSel = selected === c.key;
              const isCorrect = result && c.key === result.correctKey;
              const canSpeakEnglish = !!(c.text && c.text.trim().length > 0);

              return (
                <div key={c.key} className="rounded border p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      className="px-3 py-1 rounded border disabled:opacity-50"
                      disabled={busy || !canSpeakEnglish}
                      onClick={() => playChoice(c.key)}
                      title={canSpeakEnglish ? "「A」→英文 を読み上げ（TTS）" : "英文(text)がありません"}
                    >
                      🔊 {c.key}
                    </button>

                    <button className="px-3 py-1 rounded border" onClick={() => answer(c.key)} disabled={busy}>
                      選択
                    </button>

                    <div className="text-sm">
                      {showEn ? (
                        c.text ? (
                          <span className="font-medium">{c.text}</span>
                        ) : (
                          <span className="text-gray-400">(textなし)</span>
                        )
                      ) : null}
                      {showJa ? (c.ja ? <span className="text-gray-700">　/　{c.ja}</span> : null) : null}
                    </div>

                    {result && (
                      <div className="ml-auto text-sm">
                        {isSel && (
                          <span className={result.correct ? "text-green-700" : "text-red-700"}>
                            {result.correct ? "正解" : "不正解"}
                          </span>
                        )}
                        {isCorrect && <span className="ml-2 text-green-700">← 正解 {result.correctKey}</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ✅ ディクテーション（3択の下） */}
        {q && (
          <div className="rounded border p-3 space-y-3 bg-white">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">ディクテーション（クリック不要で連続入力）</div>
              <button className="px-2 py-1 rounded border text-xs" onClick={resetAllDict} disabled={busy}>
                全部リセット
              </button>
            </div>

            {renderDictRow("問題文", "Q")}
            {renderDictRow("A", "A")}
            {renderDictRow("B", "B")}
            {renderDictRow("C", "C")}

            <div className="text-xs text-gray-500">
              ※ 間違えるたびに「一瞬だけ」赤く点灯します（点灯しっぱなしにはなりません）。
            </div>
          </div>
        )}

        {q && result && (
          <div className="rounded border p-3 bg-white space-y-2">
            <div className="text-sm">
              あなたの解答: <b>{selected}</b> / 正解: <b>{result.correctKey}</b>
            </div>
            {q.explanation && <div className="text-sm text-gray-800 whitespace-pre-wrap">{q.explanation}</div>}
          </div>
        )}

        <div className="text-xs text-gray-500">
          ※ 音声ファイルは使用しません。読み上げはブラウザのTTS（英文＋A/B/Cラベル）です。
        </div>
      </div>
    </div>
  );
}
