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
  yomi?: string;
  createdAt: number;
  updatedAt: number;
};
type StoreV2 = { entries: Entry[]; version: 2 };
type StoreV1 = { entries: Omit<Entry, "yomi">[]; version: 1 };
type StoreAny = StoreV2 | StoreV1;

/* ========= 定数 ========= */
const LOCAL_KEY_V2 = "dictionary_v2";
const DOC_KEY = "study_dictionary_v1";

/* ========= ユーティリティ ========= */
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function migrate(raw: StoreAny | null | undefined): StoreV2 {
  if (!raw) return { entries: [], version: 2 };
  if ((raw as StoreV2).version === 2) return raw as StoreV2;
  const v1 = raw as StoreV1;
  const entries = (v1.entries ?? []).map((e) => ({
    ...e,
    yomi: "",
  }));
  return { entries, version: 2 };
}

function loadLocal(): StoreV2 {
  try {
    const raw = localStorage.getItem(LOCAL_KEY_V2);
    return raw ? migrate(JSON.parse(raw)) : { entries: [], version: 2 };
  } catch {
    return { entries: [], version: 2 };
  }
}

function saveLocal(s: StoreV2) {
  try {
    localStorage.setItem(LOCAL_KEY_V2, JSON.stringify(s));
  } catch {}
}

/* ========= 本体 ========= */
export default function Dictionary() {
  const [store, setStore] = useState<StoreV2>(() => loadLocal());
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store); // ローカル保存のみ（自動同期なし）
  }, [store]);

  /* ========= 手動同期（ホームボタン合図） ========= */
  useEffect(() => {
    let bc: BroadcastChannel | null = null;

    // クラウド → ローカル
    const pull = async () => {
      try {
        const remote = await loadUserDoc<StoreV2>(DOC_KEY);
        if (remote && remote.version === 2) {
          setStore(remote);
          saveLocal(remote);
          console.log("[dictionary] pulled from server");
        }
      } catch (e) {
        console.warn("[dictionary] pull failed", e);
      }
    };

    // ローカル → クラウド
    const push = async () => {
      try {
        await saveUserDoc<StoreV2>(DOC_KEY, storeRef.current);
        console.log("[dictionary] pushed to server");
      } catch (e) {
        console.warn("[dictionary] push failed", e);
      }
    };

    // BroadcastChannel 経由で受信
    if ("BroadcastChannel" in window) {
      bc = new BroadcastChannel("support-ai-sync");
      bc.onmessage = (ev) => {
        const t = ev.data?.type;
        if (t === "GLOBAL_PULL" || t === "GLOBAL_PULL_ALL") pull();
        if (t === "GLOBAL_PUSH" || t === "GLOBAL_PUSH_ALL") push();
      };
    }

    // postMessage 経由
    const onMsg = (ev: MessageEvent) => {
      const t = ev.data?.type;
      if (t === "GLOBAL_PULL" || t === "GLOBAL_PULL_ALL") pull();
      if (t === "GLOBAL_PUSH" || t === "GLOBAL_PUSH_ALL") push();
    };
    window.addEventListener("message", onMsg);

    // localStorage 経由
    const onStorage = (e: StorageEvent) => {
      if (e.key === "support-ai:sync:pull:req") pull();
      if (e.key === "support-ai:sync:push:req") push();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      if (bc) bc.close();
      window.removeEventListener("message", onMsg);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /* ========= CRUD ========= */
  const [term, setTerm] = useState("");
  const [meaning, setMeaning] = useState("");
  const [yomi, setYomi] = useState("");
  const [editingId, setEditingId] = useState<ID | null>(null);
  const [tmpTerm, setTmpTerm] = useState("");
  const [tmpMeaning, setTmpMeaning] = useState("");
  const [tmpYomi, setTmpYomi] = useState("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<"term" | "updatedAt" | "createdAt">("term");
  const [sortAsc, setSortAsc] = useState(true);

  const normalize = (s: string) => toSearchKey(s);

  const filtered = useMemo(() => {
    const nq = normalize(q);
    const list = store.entries.slice();
    const hit = nq
      ? list.filter(
          (e) =>
            normalize(e.term).includes(nq) || normalize(e.yomi ?? "").includes(nq)
        )
      : list;
    hit.sort((a, b) => {
      if (sortKey === "term") {
        const d = a.term.localeCompare(b.term, "ja");
        return sortAsc ? d : -d;
      }
      const d = a[sortKey] - b[sortKey];
      return sortAsc ? d : -d;
    });
    return hit;
  }, [store.entries, q, sortKey, sortAsc]);

  const add = () => {
    if (!term.trim() || !meaning.trim()) {
      alert("用語と意味を入力してください。");
      return;
    }
    const now = Date.now();
    const entry: Entry = {
      id: uid(),
      term: term.trim(),
      meaning: meaning.trim(),
      yomi: yomi.trim(),
      createdAt: now,
      updatedAt: now,
    };
    setStore((s) => ({ ...s, entries: [entry, ...s.entries] }));
    setTerm("");
    setMeaning("");
    setYomi("");
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
    const now = Date.now();
    setStore((s) => ({
      ...s,
      entries: s.entries.map((x) =>
        x.id === editingId
          ? { ...x, term: tmpTerm, meaning: tmpMeaning, yomi: tmpYomi, updatedAt: now }
          : x
      ),
    }));
    setEditingId(null);
  };

  const remove = (id: ID) => {
    setStore((s) => ({ ...s, entries: s.entries.filter((x) => x.id !== id) }));
  };

  /* ========= UI ========= */
  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">用語を追加</h2>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="用語"
          className="rounded-xl border px-3 py-2 mb-2"
        />
        <input
          value={yomi}
          onChange={(e) => setYomi(e.target.value)}
          placeholder="読み（任意）"
          className="rounded-xl border px-3 py-2 mb-2"
        />
        <textarea
          value={meaning}
          onChange={(e) => setMeaning(e.target.value)}
          placeholder="意味"
          className="rounded-xl border px-3 py-2 mb-2"
        />
        <button
          onClick={add}
          className="rounded-xl bg-black text-white px-4 py-2 font-semibold"
        >
          追加
        </button>
      </section>

      <section className="rounded-2xl border p-4 shadow-sm">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="検索"
          className="rounded-xl border px-3 py-2 mb-3"
        />
        <div className="flex items-center gap-2 mb-2">
          <label>並び替え:</label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as any)}
            className="rounded-xl border px-2 py-1 text-sm"
          >
            <option value="term">用語</option>
            <option value="updatedAt">更新日</option>
            <option value="createdAt">作成日</option>
          </select>
          <button
            onClick={() => setSortAsc((v) => !v)}
            className="rounded-xl border px-2 py-1 text-sm"
          >
            {sortAsc ? "昇順" : "降順"}
          </button>
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500">該当なし</p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((e) => (
              <li key={e.id} className="border rounded-xl p-3">
                {editingId === e.id ? (
                  <>
                    <input
                      value={tmpTerm}
                      onChange={(ev) => setTmpTerm(ev.target.value)}
                      className="w-full border rounded px-2 py-1 mb-2"
                    />
                    <input
                      value={tmpYomi}
                      onChange={(ev) => setTmpYomi(ev.target.value)}
                      className="w-full border rounded px-2 py-1 mb-2"
                    />
                    <textarea
                      value={tmpMeaning}
                      onChange={(ev) => setTmpMeaning(ev.target.value)}
                      className="w-full border rounded px-2 py-1 mb-2"
                    />
                    <button
                      onClick={commitEdit}
                      className="border rounded px-3 py-1 mr-2 text-sm"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="border rounded px-3 py-1 text-sm"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <div className="font-medium">{e.term}</div>
                    {e.yomi && <div className="text-xs text-gray-500">{e.yomi}</div>}
                    <div className="text-sm text-gray-700">{e.meaning}</div>
                    <div className="text-xs text-gray-500">
                      更新: {new Date(e.updatedAt).toLocaleString()}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={() => startEdit(e.id)}
                        className="border rounded px-3 py-1 text-sm"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => remove(e.id)}
                        className="border rounded px-3 py-1 text-sm"
                      >
                        削除
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
