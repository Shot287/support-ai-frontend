// src/features/study/close-reading.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type Role =
  | "S"
  | "V"
  | "O"
  | "C"
  | "M"
  | "SV"
  | "VC"
  | "VO"
  | "VOM"
  | "OTHER"
  | "NONE";

type Token = {
  id: string;
  text: string;
  role: Role;
};

type StoreV1 = {
  version: 1;
  inputText: string;
  tokens: Token[]; // 単語/記号ごとのタグ
  updatedAt: number;
};

const LOCAL_KEY = "study_close_reading_v1";
const DOC_KEY = "study_close_reading_v1";

const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

// 役割の表示名（必要なら増やしてOK）
const ROLE_LABELS: { role: Role; label: string }[] = [
  { role: "S", label: "S（主語）" },
  { role: "V", label: "V（動詞）" },
  { role: "O", label: "O（目的語）" },
  { role: "C", label: "C（補語）" },
  { role: "M", label: "M（修飾）" },
  { role: "SV", label: "SV（主語＋動詞のまとまり）" },
  { role: "VO", label: "VO（動詞＋目的語のまとまり）" },
  { role: "VC", label: "VC（動詞＋補語のまとまり）" },
  { role: "VOM", label: "VOM（動詞＋目的語＋修飾など）" },
  { role: "OTHER", label: "その他" },
  { role: "NONE", label: "未設定" },
];

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * 英文を「単語/記号」単位に分割して Token 化
 * - 句読点 .,!?;:() などは別トークン
 * - 空白は捨てる
 */
function tokenize(text: string): Token[] {
  // 単語（アポストロフィ含む） or 数字 or 記号 を拾う
  // e.g. don't, I'm, 24, ( ), , .
  const re = /[A-Za-z]+(?:'[A-Za-z]+)?|\d+(?:\.\d+)?|[^\sA-Za-z0-9]/g;
  const raw = text.match(re) ?? [];
  return raw.map((t) => ({
    id: newId(),
    text: t,
    role: "NONE",
  }));
}

function defaultStore(): StoreV1 {
  return {
    version: 1,
    inputText: "",
    tokens: [],
    updatedAt: Date.now(),
  };
}

function safeParseJSON<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function migrate(raw: any): StoreV1 {
  // v1のみ想定（将来v2を作るならここで吸収）
  const base = defaultStore();

  if (!raw || typeof raw !== "object") return base;
  if (raw.version !== 1) return base;

  const inputText = typeof raw.inputText === "string" ? raw.inputText : "";
  const tokens: Token[] = Array.isArray(raw.tokens)
    ? raw.tokens
        .map((x: any) => {
          if (!x || typeof x !== "object") return null;
          const text = typeof x.text === "string" ? x.text : null;
          const role = typeof x.role === "string" ? (x.role as Role) : "NONE";
          if (!text) return null;
          return { id: typeof x.id === "string" ? x.id : newId(), text, role };
        })
        .filter(Boolean) as Token[]
    : [];

  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now();

  return {
    version: 1,
    inputText,
    tokens,
    updatedAt,
  };
}

function loadLocal(): StoreV1 {
  if (typeof window === "undefined") return defaultStore();
  const raw = safeParseJSON<any>(localStorage.getItem(LOCAL_KEY));
  return migrate(raw);
}

function saveLocal(s: StoreV1) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn("[close-reading] saveLocal failed:", e);
  }
}

function isWordToken(t: string) {
  return /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(t) || /^\d+(?:\.\d+)?$/.test(t);
}

function classForRole(role: Role) {
  // Tailwind前提（色は好みで調整OK）
  switch (role) {
    case "S":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "V":
      return "bg-red-100 text-red-800 border-red-200";
    case "O":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "C":
      return "bg-purple-100 text-purple-800 border-purple-200";
    case "M":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "SV":
    case "VO":
    case "VC":
    case "VOM":
      return "bg-slate-100 text-slate-800 border-slate-200";
    case "OTHER":
      return "bg-gray-100 text-gray-800 border-gray-200";
    case "NONE":
    default:
      return "bg-white text-gray-700 border-gray-200";
  }
}

export default function CloseReading() {
  const [store, setStore] = useState<StoreV1>(() => loadLocal());
  const storeRef = useRef<StoreV1>(store);

  // UI状態（選択中トークン）
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedToken = useMemo(
    () => store.tokens.find((t) => t.id === selectedId) ?? null,
    [store.tokens, selectedId]
  );

  // ローカル即時保存
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // 手動同期購読（PULL / PUSH / LOCAL_DOC_APPLIED / storage）
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<StoreV1>(DOC_KEY);
        if (remote && remote.version === 1) {
          const migrated = migrate(remote);
          setStore(migrated);
          saveLocal(migrated);
        }
      } catch (e) {
        console.warn("[close-reading] manual PULL failed:", e);
      }
    };

    const doPush = async () => {
      try {
        await saveUserDoc<StoreV1>(DOC_KEY, storeRef.current);
      } catch (e) {
        console.warn("[close-reading] manual PUSH failed:", e);
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
            // since未使用ならnoop（直後にPULLが来る想定）
          } else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            setStore(loadLocal()); // ホームがlocalStorageを書いた合図
          }
        };
      }
    } catch {}

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
        const parsed = safeParseJSON<any>(ev.newValue);
        if (parsed) setStore(migrate(parsed));
      }
      if (ev.key === STORAGE_KEY_RESET_REQ) {
        // noop（直後にPULL）
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

  // 入力文からトークン生成（既存タグはリセット）
  const onBuild = () => {
    const tokens = tokenize(store.inputText);
    setStore((prev) => ({
      ...prev,
      tokens,
      updatedAt: Date.now(),
    }));
    setSelectedId(null);
  };

  const onClearTags = () => {
    setStore((prev) => ({
      ...prev,
      tokens: prev.tokens.map((t) => ({ ...t, role: "NONE" })),
      updatedAt: Date.now(),
    }));
  };

  const setRole = (id: string, role: Role) => {
    setStore((prev) => ({
      ...prev,
      tokens: prev.tokens.map((t) => (t.id === id ? { ...t, role } : t)),
      updatedAt: Date.now(),
    }));
  };

  const autoHint = () => {
    // 超簡易ヒント：Vっぽい単語（be動詞/一般動詞の一部）だけ V にする例
    // 本格自動判定は別途（品詞辞書やルール拡張）で作るのがおすすめ
    const vSet = new Set([
      "am",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "do",
      "does",
      "did",
      "have",
      "has",
      "had",
      "can",
      "could",
      "will",
      "would",
      "shall",
      "should",
      "may",
      "might",
      "must",
      "live",
      "exists",
      "exist",
      "make",
      "made",
      "give",
      "gave",
      "get",
      "got",
      "go",
      "went",
    ]);
    setStore((prev) => ({
      ...prev,
      tokens: prev.tokens.map((t) => {
        if (!isWordToken(t.text)) return t;
        const key = t.text.toLowerCase();
        if (vSet.has(key)) return { ...t, role: "V" };
        return t;
      }),
      updatedAt: Date.now(),
    }));
  };

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">精読（SVOCMタグ付け）</h1>
        <div className="text-xs text-gray-500">
          localStorage即時保存 / サーバ同期はホームの📥/☁のみ
        </div>
      </div>

      {/* 入力 */}
      <div className="rounded-2xl border bg-white p-4 space-y-3 shadow-sm">
        <div className="text-sm font-medium">英文を入力</div>
        <textarea
          className="w-full min-h-[110px] rounded-xl border p-3 text-sm outline-none focus:ring-2 focus:ring-gray-200"
          placeholder="例: Some fish live in fresh water, and others live in salt water."
          value={store.inputText}
          onChange={(e) =>
            setStore((prev) => ({
              ...prev,
              inputText: e.target.value,
              updatedAt: Date.now(),
            }))
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={onBuild}
          >
            単語に分解（タグ付け開始）
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={onClearTags}
            disabled={store.tokens.length === 0}
          >
            タグを全解除
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={autoHint}
            disabled={store.tokens.length === 0}
            title="超簡易のV候補だけ自動で色付け（精度は高くない）"
          >
            自動ヒント（V候補）
          </button>

          <div className="ml-auto text-xs text-gray-500">
            更新: {new Date(store.updatedAt).toLocaleString()}
          </div>
        </div>
      </div>

      {/* トークン表示 */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">単語（クリックして役割を割り当て）</div>
          <div className="text-xs text-gray-500">
            画像の考え方：まずV → 直前の名詞がS、など
          </div>
        </div>

        {store.tokens.length === 0 ? (
          <div className="text-sm text-gray-500">
            まだ分解されていません。「単語に分解（タグ付け開始）」を押してください。
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 leading-8">
            {store.tokens.map((t) => {
              const selected = t.id === selectedId;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={[
                    "rounded-xl border px-2 py-1 text-sm transition",
                    classForRole(t.role),
                    selected ? "ring-2 ring-black/10" : "hover:bg-gray-50",
                    !isWordToken(t.text) ? "opacity-80" : "",
                  ].join(" ")}
                  title={`role: ${t.role}`}
                >
                  {t.text}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 役割パネル */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
        <div className="text-sm font-medium">選択中の単語に役割を設定</div>

        {!selectedToken ? (
          <div className="text-sm text-gray-500">上の単語をクリックしてください。</div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm">
                選択:{" "}
                <span className="font-semibold">{selectedToken.text}</span>
              </div>
              <div className="text-xs text-gray-500">
                現在: {selectedToken.role}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {ROLE_LABELS.map(({ role, label }) => (
                <button
                  key={role}
                  onClick={() => setRole(selectedToken.id, role)}
                  className={[
                    "rounded-xl border px-3 py-2 text-sm hover:bg-gray-50",
                    role === selectedToken.role ? "ring-2 ring-black/10" : "",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2 border-t text-xs text-gray-600 space-y-1">
          <div>コツ：</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>まず動詞（V）を見つける → その前の名詞（代名詞）が主語（S）になりやすい</li>
            <li>他動詞なら O（目的語）が来ることが多い / 自動詞なら M（修飾）で終わりやすい</li>
            <li>and / but で並ぶときは、後半も同じ構造が繰り返されることが多い</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
