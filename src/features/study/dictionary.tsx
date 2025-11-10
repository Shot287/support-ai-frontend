// src/features/study/dictionary.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toSearchKey } from "@/features/study/kana";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

/* ========= 型 ========= */
type ID = string;
type Entry = {
  id: ID;
  term: string;
  meaning: string;
  yomi?: string; // 読み（任意・ひらがな推奨）
  createdAt: number;
  updatedAt: number;
};

type StoreV2 = { entries: Entry[]; version: 2 };

// v1 既存データ用（yomi なし）
type EntryV1 = {
  id: ID;
  term: string;
  meaning: string;
  createdAt: number;
  updatedAt: number;
};
type StoreV1 = { entries: EntryV1[]; version: 1 };

type StoreAny = StoreV2 | StoreV1;

/* ========= 定数 / ユーティリティ ========= */

// ローカル保存用キー（新方式用）＋旧キー
const LOCAL_KEY_V2 = "dictionary_v2";
const LOCAL_KEY_V1 = "dictionary_v1";

// user_docs 用の doc_key（この機能専用／将来の移行を考えて _v1 を付与）
const DOC_KEY = "study_dictionary_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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

// ローカル（localStorage）から読み込み
function loadLocal(): StoreV2 {
  try {
    if (typeof window === "undefined") {
      return { entries: [], version: 2 };
    }

    // まず新キー（v2）を試す
    const rawV2 = localStorage.getItem(LOCAL_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as StoreAny;
      return migrate(parsed);
    }

    // なければ旧キー（v1）から読み込んで migrate
    const rawV1 = localStorage.getItem(LOCAL_KEY_V1);
    const parsed = rawV1 ? (JSON.parse(rawV1) as StoreAny) : null;
    return migrate(parsed);
  } catch {
    return { entries: [], version: 2 };
  }
}

// ローカル（localStorage）に保存
function saveLocal(s: StoreV2) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_KEY_V2, JSON.stringify(s));
    }
  } catch {
    // 失敗しても無視（容量制限・プライベートモード等）
  }
}

/* ========= 本体 ========= */
export default function Dictionary() {
  const [store, setStore] = useState<StoreV2>(() => loadLocal());
  const storeRef = useRef(store);

  // 変更のたびにローカル＋サーバへ保存
  useEffect(() => {
    storeRef.current = store;
    // ローカル
    saveLocal(store);
    // サーバ（user_docs）
    (async () => {
      try {
        await saveUserDoc<StoreV2>(DOC_KEY, store);
      } catch (e) {
        console.warn("[dictionary] saveUserDoc failed:", e);
      }
    })();
  }, [store]);

  // マウント時にサーバから「最新版」を取得
  useEffect(() => {
    (async () => {
      try {
        const remote = await loadUserDoc<StoreV2>(DOC_KEY);
        if (remote && remote.version === 2) {
          // サーバにデータがあればそちらを優先
          setStore(remote);
          saveLocal(remote);
        } else if (!remote) {
          // サーバが空なら、現在のローカル状態を初期値としてアップロード
          await saveUserDoc<StoreV2>(DOC_KEY, storeRef.current);
        }
      } catch (e) {
        console.warn("[dictionary] loadUserDoc failed:", e);
      }
    })();
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

  // 正規化
  const normalize = (s: string) => toSearchKey(s);

  // 検索 + ソート（← meaning は検索対象から除外）
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

  // 追加
  const add = () => {
    const t = term.trim();
    const m = meaning.trim();
    const y = yomi.trim();
    if (!t || !m) {
      alert("用語と意味の両方を入力してください。");
      return;
    }
    const now = Date.now();
    const e: Entry = { id: uid(), term: t, meaning: m, yomi: y, createdAt: now, updatedAt: now };

    setStore((s) => ({ ...s, entries: [e, ...s.entries] }));
    setTerm("");
    setMeaning("");
    setYomi("");
    termRef.current?.focus();
  };

  // 編集開始
  const startEdit = (id: ID) => {
    const e = store.entries.find((x) => x.id === id);
    if (!e) return;
    setEditingId(id);
    setTmpTerm(e.term);
    setTmpMeaning(e.meaning);
    setTmpYomi(e.yomi ?? "");
  };

  // 編集確定（保存）
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
          ? ({ ...x, term: t, meaning: m, yomi: y, updatedAt: now } as Entry)
          : x
      ) as Entry[];
      return { ...s, entries };
    });
    setEditingId(null);
  };

  // 削除
  const remove = (id: ID) => {
    setStore((s) => ({ ...s, entries: s.entries.filter((x) => x.id !== id) }));
  };

  // 全削除
  const clearAll = () => {
    if (!confirm("全件削除します。よろしいですか？")) return;
    setStore({ entries: [], version: 2 });
  };

  // JSON 入出力（setStore すればローカル＋サーバ両方に反映）
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dictionary_export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = migrate(JSON.parse(String(reader.result)) as StoreAny);
        setStore(parsed);
        alert("インポートしました（ローカルとクラウドの両方に反映されます）。");
      } catch {
        alert("JSONの読み込みに失敗しました。");
      }
    };
    reader.readAsText(file);
  };

  /* ========= UI ========= */
  return (
    <div className="grid gap-6">
      {/* 追加フォーム */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">用語を追加</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            ref={termRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="用語（例：微分方程式）"
            className="rounded-xl border px-3 py-3"
            aria-label="用語"
          />
          <div className="flex gap-2">
            <input
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
              placeholder="意味（例：導関数を含む方程式）"
              className="flex-1 rounded-xl border px-3 py-3"
              aria-label="意味"
            />
            <button
              onClick={add}
              className="rounded-xl bg-black px-5 py-3 text-white font-semibold"
            >
              追加
            </button>
          </div>
          <input
            value={yomi}
            onChange={(e) => setYomi(e.target.value)}
            placeholder="読み（任意・ひらがな）"
            className="rounded-xl border px-3 py-3"
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
            placeholder="検索（用語／読み のみが対象）"
            className="rounded-xl border px-3 py-3"
            aria-label="検索（用語・読み）"
          />
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">並び替え:</label>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
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
              const fmt = (t: number) =>
                new Intl.DateTimeFormat("ja-JP", {
                  timeZone: "Asia/Tokyo",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(new Date(t));

              return (
                <li
                  key={e.id}
                  className="rounded-xl border p-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  {!isEditing ? (
                    <>
                      <div className="min-w-0">
                        <div className="font-medium break-words">{e.term}</div>
                        {e.yomi && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            よみ: {e.yomi}
                          </div>
                        )}
                        <div className="text-sm text-gray-700 break-words">
                          {e.meaning}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          作成: {fmt(e.createdAt)} ／ 更新: {fmt(e.updatedAt)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
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
                      <div className="min-w-0">
                        <input
                          value={tmpTerm}
                          onChange={(ev) => setTmpTerm(ev.target.value)}
                          className="w-full rounded-lg border px-3 py-2 text-sm mb-2"
                          placeholder="用語"
                          autoFocus
                        />
                        <input
                          value={tmpYomi}
                          onChange={(ev) => setTmpYomi(ev.target.value)}
                          className="w-full rounded-lg border px-3 py-2 text-sm mb-2"
                          placeholder="読み（任意・ひらがな）"
                        />
                        <textarea
                          value={tmpMeaning}
                          onChange={(ev) => setTmpMeaning(ev.target.value)}
                          className="w-full rounded-lg border px-3 py-2 text-sm"
                          placeholder="意味"
                          rows={3}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
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
