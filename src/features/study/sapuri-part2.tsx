// src/features/study/sapuri-part2.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

type ChoiceKey = "A" | "B" | "C";

type Choice = {
  key: ChoiceKey;
  text?: string; // 任意（表示用）
  ja?: string; // 任意（表示用）
  audioUrl?: string; // 例: "/audio/part2/q001_A.mp3" など
};

type Part2Question = {
  id: ID;

  // 表示テキスト（音声だけで運用するなら空でもOK）
  qText?: string;
  qJa?: string;

  // 問題音声（必須推奨）
  qAudioUrl?: string;

  // 選択肢（A/B/C）
  choices: Choice[];

  // 正解
  correct: ChoiceKey;

  // 解説
  explanation?: string;

  // 任意メタ
  speaker?: { q?: string; a?: string }; // 例: { q:"イギリス", a:"オーストラリア" }
};

type StoreV1 = {
  version: 1;
  updatedAt: number;
  questions: Part2Question[];
  settings: {
    autoplaySequence: boolean; // 問題→A→B→C を自動再生
    showText: boolean; // 英日テキストを表示する
  };
  progress: {
    currentIndex: number; // 0-based
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
  // v1のみ（将来version増えたらここに足す）
  const base: StoreV1 = {
    version: 1,
    updatedAt: Date.now(),
    questions: [],
    settings: { autoplaySequence: true, showText: true },
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
          const audioUrl =
            typeof c.audioUrl === "string" ? c.audioUrl : undefined;
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
        qAudioUrl:
          typeof q.qAudioUrl === "string" ? q.qAudioUrl : undefined,
        choices: (["A", "B", "C"] as ChoiceKey[]).map((k) => byKey.get(k)!),
        correct,
        explanation:
          typeof q.explanation === "string" ? q.explanation : undefined,
        speaker:
          q.speaker && typeof q.speaker === "object"
            ? {
                q:
                  typeof q.speaker.q === "string" ? q.speaker.q : undefined,
                a:
                  typeof q.speaker.a === "string" ? q.speaker.a : undefined,
              }
            : undefined,
      } as Part2Question;
    })
    .filter(Boolean);

  const settings =
    raw.settings && typeof raw.settings === "object" ? raw.settings : {};
  const progress =
    raw.progress && typeof raw.progress === "object" ? raw.progress : {};

  const merged: StoreV1 = {
    version: 1,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
    questions,
    settings: {
      autoplaySequence:
        typeof settings.autoplaySequence === "boolean"
          ? settings.autoplaySequence
          : base.settings.autoplaySequence,
      showText:
        typeof settings.showText === "boolean"
          ? settings.showText
          : base.settings.showText,
    },
    progress: {
      currentIndex:
        typeof progress.currentIndex === "number"
          ? Math.max(0, progress.currentIndex)
          : 0,
      lastAnswered:
        progress.lastAnswered && typeof progress.lastAnswered === "object"
          ? {
              qid:
                typeof progress.lastAnswered.qid === "string"
                  ? progress.lastAnswered.qid
                  : "",
              selected: (normalizeChoiceKey(progress.lastAnswered.selected) ??
                "A") as ChoiceKey,
              correct: !!progress.lastAnswered.correct,
              answeredAt:
                typeof progress.lastAnswered.answeredAt === "number"
                  ? progress.lastAnswered.answeredAt
                  : Date.now(),
            }
          : undefined,
    },
  };

  // currentIndexが範囲外なら丸める
  if (merged.questions.length === 0) merged.progress.currentIndex = 0;
  else
    merged.progress.currentIndex = Math.min(
      merged.progress.currentIndex,
      merged.questions.length - 1
    );

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

async function playUrl(
  url: string,
  audioRef: React.MutableRefObject<HTMLAudioElement | null>
) {
  if (!url) return;
  const a = audioRef.current ?? new Audio();
  audioRef.current = a;

  // 前の再生を止める
  try {
    a.pause();
    a.currentTime = 0;
  } catch {}

  return new Promise<void>((resolve, reject) => {
    a.onended = () => resolve();
    a.onerror = () => reject(new Error("audio error"));
    a.src = url;
    a.play().catch(reject);
  });
}

export default function SapuriPart2() {
  const [store, setStore] = useState<StoreV1>(() => {
    if (typeof window === "undefined") return migrate(null);
    return loadLocal();
  });
  const storeRef = useRef(store);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const q = useMemo(() => {
    const list = store.questions;
    if (!list.length) return null;
    const i = Math.min(store.progress.currentIndex, list.length - 1);
    return list[i];
  }, [store.questions, store.progress.currentIndex]);

  const [selected, setSelected] = useState<ChoiceKey | null>(null);
  const [result, setResult] = useState<null | {
    correct: boolean;
    correctKey: ChoiceKey;
  }>(null);
  const [busy, setBusy] = useState(false);

  // ✅ 追加：ペースト用UI
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  // ローカルへ即時保存（サーバ保存はしない）
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
        // noop（直後にPULL想定）
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

  // 問題切り替え時に表示状態をリセット
  useEffect(() => {
    setSelected(null);
    setResult(null);
  }, [q?.id]);

  const canPlay = !!q;

  const playSequence = async () => {
    if (!q) return;
    setBusy(true);
    try {
      if (q.qAudioUrl) await playUrl(q.qAudioUrl, audioRef);
      for (const c of q.choices) {
        if (c.audioUrl) await playUrl(c.audioUrl, audioRef);
      }
    } catch (e) {
      console.warn("playSequence failed:", e);
    } finally {
      setBusy(false);
    }
  };

  const playQuestionOnly = async () => {
    if (!q?.qAudioUrl) return;
    setBusy(true);
    try {
      await playUrl(q.qAudioUrl, audioRef);
    } catch (e) {
      console.warn("playQuestionOnly failed:", e);
    } finally {
      setBusy(false);
    }
  };

  const playChoice = async (key: ChoiceKey) => {
    if (!q) return;
    const c = q.choices.find((x) => x.key === key);
    if (!c?.audioUrl) return;
    setBusy(true);
    try {
      await playUrl(c.audioUrl, audioRef);
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
      return {
        ...prev,
        updatedAt: Date.now(),
        progress: { ...prev.progress, currentIndex: ni },
      };
    });
  };

  const prevQ = () => {
    setStore((prev) => {
      const ni = Math.max(prev.progress.currentIndex - 1, 0);
      return {
        ...prev,
        updatedAt: Date.now(),
        progress: { ...prev.progress, currentIndex: ni },
      };
    });
  };

  const toggle = (k: keyof StoreV1["settings"]) => {
    setStore((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      settings: { ...prev.settings, [k]: !prev.settings[k] },
    }));
  };

  // ✅ 共通：JSON → questions を取り込む（file/importText 両方で使用）
  const applyImported = (parsed: any) => {
    // 期待: { version:1, questions:[...] } または questions配列単体
    const incoming = Array.isArray(parsed)
      ? { version: 1, questions: parsed }
      : parsed;

    const m = migrate(incoming);

    setStore((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      questions: m.questions,
      progress: { ...prev.progress, currentIndex: 0 },
    }));
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

  // ✅ 追加：ペースト文字列インポート
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
    } catch (e: any) {
      setImportError("JSONの解析に失敗しました（カンマ/括弧/引用符などを確認）。");
      console.warn(e);
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sapuri_part2_store.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const total = store.questions.length;
  const idx = total ? store.progress.currentIndex + 1 : 0;

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

      {/* ✅ 追加：ペーストインポート */}
      <div className="rounded border p-3 space-y-2">
        <div className="text-sm font-semibold">JSONをペーストしてインポート</div>
        <textarea
          className="w-full rounded border p-2 text-sm font-mono"
          rows={6}
          placeholder='ここにJSONを貼り付け → 「ペーストインポート」を押す
例: { "version": 1, "questions": [...] }'
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <button className="px-3 py-1 rounded border" onClick={importFromText}>
            ペーストインポート
          </button>
          <button
            className="px-3 py-1 rounded border"
            onClick={() => {
              setImportText("");
              setImportError(null);
            }}
          >
            クリア
          </button>
          {importError && (
            <div className="text-sm text-red-700">{importError}</div>
          )}
        </div>
      </div>

      <div className="rounded border p-3 text-sm flex flex-wrap gap-3 items-center">
        <button
          className="px-3 py-1 rounded border"
          onClick={() => toggle("autoplaySequence")}
        >
          自動再生: {store.settings.autoplaySequence ? "ON" : "OFF"}
        </button>
        <button
          className="px-3 py-1 rounded border"
          onClick={() => toggle("showText")}
        >
          テキスト表示: {store.settings.showText ? "ON" : "OFF"}
        </button>
        <div className="ml-auto text-gray-600">
          {total ? `${idx}/${total}` : "問題がありません（JSONをインポートしてください）"}
        </div>
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
            ▶ 再生（問題{store.settings.autoplaySequence ? "→ABC" : ""}）
          </button>

          <button
            className="px-3 py-2 rounded border disabled:opacity-50"
            disabled={!q || busy}
            onClick={prevQ}
          >
            ← 前へ
          </button>
          <button
            className="px-3 py-2 rounded border disabled:opacity-50"
            disabled={!q || busy}
            onClick={next}
          >
            次へ →
          </button>
        </div>

        {q && store.settings.showText && (
          <div className="space-y-1">
            {q.qText && <div className="text-base font-medium">{q.qText}</div>}
            {q.qJa && <div className="text-gray-700">{q.qJa}</div>}
            {(q.speaker?.q || q.speaker?.a) && (
              <div className="text-xs text-gray-500">
                {q.speaker?.q ? `Q: ${q.speaker.q}` : ""}
                {q.speaker?.q && q.speaker?.a ? " / " : ""}
                {q.speaker?.a ? `A: ${q.speaker.a}` : ""}
              </div>
            )}
          </div>
        )}

        {q && (
          <div className="space-y-2">
            {q.choices.map((c) => {
              const isSel = selected === c.key;
              const isCorrect = result && c.key === result.correctKey;
              return (
                <div key={c.key} className="rounded border p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      className="px-3 py-1 rounded border disabled:opacity-50"
                      disabled={busy || !c.audioUrl}
                      onClick={() => playChoice(c.key)}
                      title={c.audioUrl ? "選択肢音声を再生" : "audioUrl未設定"}
                    >
                      🔊 {c.key}
                    </button>

                    <button
                      className="px-3 py-1 rounded border"
                      onClick={() => answer(c.key)}
                      disabled={busy}
                    >
                      選択
                    </button>

                    {store.settings.showText && (
                      <div className="text-sm">
                        {c.text ? (
                          <span className="font-medium">{c.text}</span>
                        ) : (
                          <span className="text-gray-400">(textなし)</span>
                        )}
                        {c.ja ? (
                          <span className="text-gray-700">　/　{c.ja}</span>
                        ) : null}
                      </div>
                    )}

                    {result && (
                      <div className="ml-auto text-sm">
                        {isSel && (
                          <span
                            className={
                              result.correct ? "text-green-700" : "text-red-700"
                            }
                          >
                            {result.correct ? "正解" : "不正解"}
                          </span>
                        )}
                        {isCorrect && (
                          <span className="ml-2 text-green-700">
                            ← 正解 {result.correctKey}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {q && result && (
          <div className="rounded border p-3 bg-white space-y-2">
            <div className="text-sm">
              あなたの解答: <b>{selected}</b> / 正解: <b>{result.correctKey}</b>
            </div>
            {q.explanation && (
              <div className="text-sm text-gray-800 whitespace-pre-wrap">
                {q.explanation}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
