// src/features/study/math-dictionary.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toSearchKey } from "@/features/study/kana";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
// ※ KaTeX の CSS は app/layout.tsx かグローバルCSSで読み込んでください。
// 例: import "katex/dist/katex.min.css";

/* ========= 型 ========= */
type ID = string;

type Entry = {
  id: ID;
  term: string;    // 用語（数式を含んでもOK）
  meaning: string; // 意味（数式を含んでもOK）
  yomi?: string;   // 読み（数式を含んでもOK／任意）
  createdAt: number;
  updatedAt: number;
};

type StoreV2 = { entries: Entry[]; version: 2 };

// v1 がもし将来できたとき用の型（今は実質未使用だが安全のため残す）
type EntryV1 = {
  id: ID;
  term: string;
  meaning: string;
  createdAt: number;
  updatedAt: number;
};
type StoreV1 = { entries: EntryV1[]; version: 1 };

type StoreAny = StoreV2 | StoreV1;

/* ========= LaTeX/Gemini テキスト自動補正 ========= */
// 1) ¥ (U+00A5) を \ に変換
// 2) $$ ... $$ を前後改行付きのブロック形式に整える
function normalizeMathText(raw: string): string {
  if (!raw) return "";

  let text = raw;

  // 1) 日本語環境で紛れ込みがちな「¥」をバックスラッシュに変換
  text = text.replace(/¥/g, "\\");

  // 2) $$ ... $$ ブロックを前後改行付きの独立ブロックに整形
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_match, inner) => {
    const trimmed = String(inner).trim();
    return `\n$$\n${trimmed}\n$$\n`;
  });

  return text;
}

// KaTeX + remark-math でレンダリングする汎用コンポーネント
function MathMarkdown({ text }: { text: string }) {
  const normalized = normalizeMathText(text);

  if (!normalized.trim()) {
    return (
      <span className="text-xs text-gray-400 italic align-baseline">
        （未入力）
      </span>
    );
  }

  return (
    <span className="prose max-w-none prose-sm align-baseline">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {normalized}
      </ReactMarkdown>
    </span>
  );
}

/* ========= 定数 / ユーティリティ ========= */
// ローカル保存用キー
const LOCAL_KEY_V2 = "math_dictionary_v2";
const LOCAL_KEY_V1 = "math_dictionary_v1"; // 互換用（今はほぼ未使用）

// user_docs 用の doc_key（手動同期）
const DOC_KEY = "study_math_dictionary_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

// v1 → v2 マイグレーション（yomi を空で補完）
function migrate(raw: StoreAny | null | undefined): StoreV2 {
  if (!raw) return { entries: [], version: 2 };
  if ((raw as StoreV2).version === 2) return raw as StoreV2;
  const v1 = raw as StoreV1;
  const entries: Entry[] = (v1.entries ?? []).map((e) => ({
    id: e.id,
    term: e.term,
    meaning: e.meaning,
    yomi: "",
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
  return { entries, version: 2 };
}

// ローカル読み込み
function loadLocal(): StoreV2 {
  try {
    if (typeof window === "undefined") return { entries: [], version: 2 };
    const rawV2 = localStorage.getItem(LOCAL_KEY_V2);
    if (rawV2) return migrate(JSON.parse(rawV2) as StoreAny);
    const rawV1 = localStorage.getItem(LOCAL_KEY_V1);
    const parsed = rawV1 ? (JSON.parse(rawV1) as StoreAny) : null;
    return migrate(parsed);
  } catch {
    return { entries: [], version: 2 };
  }
}

// ローカル保存
function saveLocal(s: StoreV2) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_KEY_V2, JSON.stringify(s));
    }
  } catch {
    // noop
  }
}

/* ========= 本体 ========= */
export default function MathDictionary() {
  const [store, setStore] = useState<StoreV2>(() => loadLocal());
  const storeRef = useRef(store);

  // ローカルへは即時保存（サーバー反映はホームのボタン経由のみ）
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // ---- 手動同期の合図を購読（manual-sync.ts に一本化） ----
  useEffect(() => {
    const unsubscribe = registerManualSync({
      // 📥 取得（クラウド→ローカル）
      pull: async () => {
        try {
          const remote = await loadUserDoc<StoreV2>(DOC_KEY);
          if (remote && remote.version === 2) {
            setStore(remote);
            saveLocal(remote);
          }
        } catch (e) {
          console.warn("[math-dictionary] manual PULL failed:", e);
        }
      },
      // ☁ アップロード（ローカル→クラウド）
      push: async () => {
        try {
          await saveUserDoc<StoreV2>(DOC_KEY, storeRef.current);
        } catch (e) {
          console.warn("[math-dictionary] manual PUSH failed:", e);
        }
      },
      // ⚠ RESET: since 未使用なので特別な処理は不要
      reset: async () => {
        /* no-op */
      },
    });
    return unsubscribe;
  }, []);

  // 追加フォーム
  const [term, setTerm] = useState("");
  const [meaning, setMeaning] = useState("");
  const [yomi, setYomi] = useState("");
  const termRef = useRef<HTMLInputElement | null>(null);

  // 検索/ソート
  const [q, setQ] = useState("");
  type SortKey = "createdAt" | "updatedAt" | "term";
  const [sortKey, setSortKey] = useState<SortKey>("term");
  const [sortAsc, setSortAsc] = useState(true);

  // 編集
  const [editingId, setEditingId] = useState<ID | null>(null);
  const [tmpTerm, setTmpTerm] = useState("");
  const [tmpMeaning, setTmpMeaning] = useState("");
  const [tmpYomi, setTmpYomi] = useState("");

  // 正規化（かな検索用）
  const normalize = (s: string) => toSearchKey(s);

  // 検索 + ソート（meaning は検索対象から除外）
  const filtered = useMemo(() => {
    const nq = normalize(q.trim());
    const list = store.entries.slice();
    const hit = nq
      ? list.filter((e) => {
          const t = normalize(e.term);
          const y = normalize(e.yomi ?? "");
          return t.includes(nq) || y.includes(nq);
        })
      : list;

    hit.sort((a, b) => {
      if (sortKey === "term") {
        const d = a.term.localeCompare(b.term, "ja");
        return sortAsc ? d : -d;
      }
      const d = (a[sortKey] as number) - (b[sortKey] as number);
      return sortAsc ? d : -d;
    });

    return hit;
  }, [store.entries, q, sortKey, sortAsc]);

  /* ========= CRUD ========= */
  const add = () => {
    const t = term.trim();
    const m = meaning.trim();
    const y = yomi.trim();
    if (!t || !m) {
      alert("用語と意味の両方を入力してください。");
      return;
    }
    const now = Date.now();
    const e: Entry = {
      id: uid(),
      term: t,
      meaning: m,
      yomi: y,
      createdAt: now,
      updatedAt: now,
    };
    setStore((s) => ({ ...s, entries: [e, ...s.entries] }));
    setTerm("");
    setMeaning("");
    setYomi("");
    termRef.current?.focus();
  };

  const startEdit = (id: ID) => {
    const e = store.entries.find((x) => x.id === id);
    if (!e) return;
    setEditingId(id);
    setTmpTerm(e.term);
    setTmpMeaning(e.meaning);
    setTmpYomi(e.yomi ?? "");
  };

  const commitEdit = () => {
    if (!editingId) return;
    const t = tmpTerm.trim();
    const m = tmpMeaning.trim();
    const y = tmpYomi.trim();
    if (!t || !m) {
      alert("用語と意味の両方を入力してください。");
      return;
    }
    const now = Date.now();
    setStore((s) => {
      const entries = s.entries.map((x) =>
        x.id === editingId
          ? ({
              ...x,
              term: t,
              meaning: m,
              yomi: y,
              updatedAt: now,
            } as Entry)
          : x
      ) as Entry[];
      return { ...s, entries };
    });
    setEditingId(null);
  };

  const remove = (id: ID) => {
    setStore((s) => ({
      ...s,
      entries: s.entries.filter((x) => x.id !== id),
    }));
  };

  const clearAll = () => {
    if (!confirm("全件削除します。よろしいですか？")) return;
    setStore({ entries: [], version: 2 });
  };

  // JSON 入出力（サーバ反映はホームの「アップロード」で）
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `math_dictionary_export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = migrate(JSON.parse(String(reader.result)) as StoreAny);
        setStore(parsed); // ローカルに反映。サーバ反映はホームの「アップロード」
        alert(
          "インポートしました（ローカルに反映。サーバへは『アップロード』で同期）。"
        );
      } catch {
        alert("JSONの読み込みに失敗しました。");
      }
    };
    reader.readAsText(file);
  };

  const fmtDateTime = (t: number) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(t));

  /* ========= UI ========= */
  return (
    <div className="grid gap-6">
      {/* 追加フォーム */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">数学の記号・用語を追加（Gemini対応）</h2>
        <p className="text-xs text-gray-500 mb-3">
          Gemini や ChatGPT の出力をそのまま貼り付けできます。
          <br />
          「¥」は自動で「\」に変換され、<code>$$ … $$</code>
          ブロックも自動整形されて KaTeX で表示されます。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            ref={termRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="用語（例: $\\int_0^1 f(x)\\,dx$ や ベクトル空間 など）"
            className="rounded-xl border px-3 py-3 text-sm font-mono"
            aria-label="用語"
          />
          <div className="flex gap-2">
            <input
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
              placeholder="意味（例: 区間[0,1]における積分値 など）"
              className="flex-1 rounded-xl border px-3 py-3 text-sm font-mono"
              aria-label="意味"
            />
            <button
              onClick={add}
              className="rounded-xl bg-black px-5 py-3 text-white font-semibold text-sm"
            >
              追加
            </button>
          </div>
          <input
            value={yomi}
            onChange={(e) => setYomi(e.target.value)}
            placeholder="読み（任意。LaTeX or ひらがな ど）"
            className="rounded-xl border px-3 py-3 text-sm font-mono"
            aria-label="読み"
          />
        </div>
      </section>

      {/* 検索・並び替え・入出力 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="検索（用語／読み のみが対象。LaTeX 含んでもOK）"
            className="rounded-xl border px-3 py-3 text-sm"
            aria-label="検索（用語・読み）"
          />
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">並び替え:</label>
            <select
              value={sortKey}
              onChange={(e) =>
                setSortKey(e.target.value as "createdAt" | "updatedAt" | "term")
              }
              className="rounded-xl border px-2 py-2 text-sm"
            >
              <option value="term">用語（50音順）</option>
              <option value="updatedAt">更新日</option>
              <option value="createdAt">作成日</option>
            </select>
            <button
              onClick={() => setSortAsc((v) => !v)}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              title="昇順/降順を切替"
            >
              {sortAsc ? "昇順" : "降順"}
            </button>
          </div>
          <div className="text-sm text-gray-600 text-right">
            {filtered.length} / {store.entries.length} 件
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={exportJson}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            エクスポート（JSON）
          </button>
          <label className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
            インポート
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => importJson(e.target.files?.[0] ?? null)}
            />
          </label>
          {store.entries.length > 0 && (
            <button
              onClick={clearAll}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            >
              全削除
            </button>
          )}
        </div>
      </section>

      {/* 一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500">該当する項目がありません。</p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((e) => {
              const isEditing = editingId === e.id;
              return (
                <li
                  key={e.id}
                  className="rounded-xl border p-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center bg-white"
                >
                  {!isEditing ? (
                    <>
                      <div className="min-w-0 space-y-1">
                        {/* 用語（MathMarkdown 表示） */}
                        <div className="font-medium break-words text-sm">
                          <MathMarkdown text={e.term} />
                        </div>

                        {/* 読み（任意） */}
                        {e.yomi && (
                          <div className="text-xs text-gray-500">
                            <span className="mr-1">よみ:</span>
                            <MathMarkdown text={e.yomi} />
                          </div>
                        )}

                        {/* 意味（MathMarkdown 表示） */}
                        <div className="text-sm text-gray-700 break-words mt-1">
                          <MathMarkdown text={e.meaning} />
                        </div>

                        <div className="text-xs text-gray-500 mt-1">
                          作成: {fmtDateTime(e.createdAt)} ／ 更新:{" "}
                          {fmtDateTime(e.updatedAt)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 justify-end">
                        <button
                          onClick={() => startEdit(e.id)}
                          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => remove(e.id)}
                          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          削除
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0 space-y-2">
                        <input
                          value={tmpTerm}
                          onChange={(ev) => setTmpTerm(ev.target.value)}
                          className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                          placeholder="用語"
                          autoFocus
                        />
                        <input
                          value={tmpYomi}
                          onChange={(ev) => setTmpYomi(ev.target.value)}
                          className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                          placeholder="読み（任意）"
                        />
                        <textarea
                          value={tmpMeaning}
                          onChange={(ev) => setTmpMeaning(ev.target.value)}
                          className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                          placeholder="意味"
                          rows={3}
                        />

                        {/* 3項目まとめて Gemini/LaTeX プレビュー */}
                        <div className="mt-2 rounded-lg border px-3 py-2 bg-gray-50 text-xs text-gray-600 space-y-1">
                          <div>
                            <span className="font-semibold mr-1">用語:</span>
                            <MathMarkdown text={tmpTerm} />
                          </div>
                          <div>
                            <span className="font-semibold mr-1">読み:</span>
                            <MathMarkdown text={tmpYomi} />
                          </div>
                          <div>
                            <span className="font-semibold mr-1">意味:</span>
                            <MathMarkdown text={tmpMeaning} />
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 justify-end">
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
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
