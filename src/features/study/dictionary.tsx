// src/features/study/dictionary.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toHiragana } from "wanakana"; // ★ 追加：ひらがな変換ライブラリ

/* ========== 型 ========== */
type ID = string;
type Entry = { id: ID; term: string; meaning: string; createdAt: number; updatedAt: number };
type Store = { entries: Entry[]; version: 1 };

/* ========== 定数/ユーティリティ ========== */
const KEY = "dictionary_v1";
const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function load(): Store {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return { entries: [], version: 1 };
    const parsed = JSON.parse(raw) as Store;
    return parsed?.version ? parsed : { entries: [], version: 1 };
  } catch {
    return { entries: [], version: 1 };
  }
}
function save(s: Store) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s));
}

// ✅ normalizeを拡張：小文字化＋全角正規化＋ひらがな変換
function normalize(s: string) {
  const base = s.toLowerCase().normalize("NFKC");
  try {
    return toHiragana(base); // ★ 追加：漢字・カタカナも含めひらがな化
  } catch {
    return base;
  }
}

/* ========== 本体 ========== */
export default function Dictionary() {
  const [store, setStore] = useState<Store>(() => load());
  useEffect(() => save(store), [store]);

  const [term, setTerm] = useState("");
  const [meaning, setMeaning] = useState("");
  const termRef = useRef<HTMLInputElement | null>(null);

  const [q, setQ] = useState("");
  type SortKey = "createdAt" | "updatedAt" | "term";
  const [sortKey, setSortKey] = useState<SortKey>("term");
  const [sortAsc, setSortAsc] = useState(true);

  const [editingId, setEditingId] = useState<ID | null>(null);
  const [tmpTerm, setTmpTerm] = useState("");
  const [tmpMeaning, setTmpMeaning] = useState("");

  /* ===== 検索＋ソート ===== */
  const filtered = useMemo(() => {
    const nq = normalize(q.trim());
    const list = store.entries.slice();

    const hit = nq
      ? list.filter((e) => {
          const t = normalize(e.term);
          const m = normalize(e.meaning);
          return t.includes(nq) || m.includes(nq);
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

  /* ===== CRUD処理 ===== */
  const add = () => {
    const t = term.trim();
    const m = meaning.trim();
    if (!t || !m) {
      alert("用語と意味の両方を入力してください。");
      return;
    }
    const now = Date.now();
    const e: Entry = { id: uid(), term: t, meaning: m, createdAt: now, updatedAt: now };
    setStore((s) => ({ ...s, entries: [e, ...s.entries] }));
    setTerm("");
    setMeaning("");
    termRef.current?.focus();
  };

  const startEdit = (id: ID) => {
    const e = store.entries.find((x) => x.id === id);
    if (!e) return;
    setEditingId(id);
    setTmpTerm(e.term);
    setTmpMeaning(e.meaning);
  };

  const commitEdit = () => {
    if (!editingId) return;
    const t = tmpTerm.trim();
    const m = tmpMeaning.trim();
    if (!t || !m) {
      alert("用語と意味の両方を入力してください。");
      return;
    }
    const now = Date.now();
    setStore((s) => ({
      ...s,
      entries: s.entries.map((x) =>
        x.id === editingId ? { ...x, term: t, meaning: m, updatedAt: now } : x
      ),
    }));
    setEditingId(null);
  };

  const remove = (id: ID) =>
    setStore((s) => ({ ...s, entries: s.entries.filter((x) => x.id !== id) }));

  const clearAll = () => {
    if (!confirm("全件削除します。よろしいですか？")) return;
    setStore({ entries: [], version: 1 });
  };

  /* ===== JSON入出力 ===== */
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
        const parsed = JSON.parse(String(reader.result)) as Store;
        if (!parsed?.version || !Array.isArray(parsed.entries))
          throw new Error("invalid");
        const map = new Map<ID, Entry>();
        for (const e of store.entries) map.set(e.id, e);
        for (const e of parsed.entries) map.set(e.id, e);
        setStore({ version: 1, entries: Array.from(map.values()) });
        alert("インポートしました。");
      } catch {
        alert("JSONの読み込みに失敗しました。");
      }
    };
    reader.readAsText(file);
  };

  /* ===== 描画 ===== */
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
          />
          <div className="flex gap-2">
            <input
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
              placeholder="意味（例：関数の導関数を含む方程式）"
              className="flex-1 rounded-xl border px-3 py-3"
            />
            <button
              onClick={add}
              className="rounded-xl bg-black px-5 py-3 text-white font-semibold"
            >
              追加
            </button>
          </div>
        </div>
      </section>

      {/* 検索・並び替え */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="検索（漢字・かなのどちらでも検索可能）"
            className="rounded-xl border px-3 py-3"
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
            >
              {sortAsc ? "昇順" : "降順"}
            </button>
          </div>
          <div className="text-sm text-gray-600 text-right">
            {filtered.length} / {store.entries.length} 件
          </div>
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
                  className="rounded-xl border p-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  {!isEditing ? (
                    <>
                      <div className="min-w-0">
                        <div className="font-medium break-words">{e.term}</div>
                        <div className="text-sm text-gray-700 break-words">
                          {e.meaning}
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
