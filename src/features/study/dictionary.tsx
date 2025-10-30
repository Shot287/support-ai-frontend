// src/features/study/dictionary.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toSearchKey } from "@/features/study/kana";

// ▼ 同期ユーティリティ
import { pullBatch, pushBatch } from "@/lib/sync";
import { subscribeGlobalPush } from "@/lib/sync-bus";
import { getDeviceId } from "@/lib/device";

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
const KEY = "dictionary_v1";

// ★ 同期関連（簡易版）
const USER_ID = "demo"; // 認証導入までは固定
// ✅ チェックリストとSINCEを共有しないよう辞書専用キーにする
const SINCE_KEY = `support-ai:sync:since:${USER_ID}:dictionary`;
const getSince = () => {
  const v = typeof window !== "undefined" ? localStorage.getItem(SINCE_KEY) : null;
  return v ? Number(v) : 0;
};
const setSince = (ms: number) => {
  if (typeof window !== "undefined") localStorage.setItem(SINCE_KEY, String(ms));
};

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
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

function load(): StoreV2 {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as StoreAny) : null;
    return migrate(parsed);
  } catch {
    return { entries: [], version: 2 };
  }
}

function save(s: StoreV2) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s));
}

/* ========= 本体 ========= */
export default function Dictionary() {
  const [store, setStore] = useState<StoreV2>(() => load());
  const storeRef = useRef(store);
  useEffect(() => save(store), [store]);
  useEffect(() => {
    storeRef.current = store;
  }, [store]);

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

  /* ========= 同期：受信（PULL） ========= */

  // サーバ差分をローカルへ反映（data(jsonb) / 直列カラム の両対応）
  const applyEntryDiffs = (rows: Array<{
    id: string;
    user_id: string;
    term?: string | null;
    yomi?: string | null;
    meaning?: string | null;
    updated_at: number;
    updated_by?: string | null;
    deleted_at?: number | null;
    data?: { term?: string | null; yomi?: string | null; meaning?: string | null };
  }>) => {
    if (!rows || rows.length === 0) return;

    setStore((prev) => {
      const idx = new Map(prev.entries.map((e, i) => [e.id, i] as const));
      const entries = prev.entries.slice();

      for (const r of rows) {
        const term = r.term ?? r.data?.term ?? null;
        const yomi = r.yomi ?? r.data?.yomi ?? null;
        const meaning = r.meaning ?? r.data?.meaning ?? null;

        if (r.deleted_at) {
          const i = idx.get(r.id);
          if (i !== undefined) {
            entries.splice(i, 1);
            idx.clear();
            entries.forEach((e, k) => idx.set(e.id, k));
          }
          continue;
        }

        const i = idx.get(r.id);
        if (i === undefined) {
          entries.unshift({
            id: r.id,
            term: String(term ?? ""),
            yomi: yomi ?? "",
            meaning: String(meaning ?? ""),
            createdAt: r.updated_at ?? Date.now(), // createdAt不明の場合はupdated_atで代用
            updatedAt: r.updated_at ?? Date.now(),
          });
          idx.set(r.id, 0);
        } else {
          const cur = entries[i];
          entries[i] = {
            ...cur,
            term: term != null ? String(term) : cur.term,
            yomi: yomi != null ? String(yomi) : (cur.yomi ?? ""),
            meaning: meaning != null ? String(meaning) : cur.meaning,
            updatedAt: r.updated_at ?? cur.updatedAt,
          };
        }
      }

      return { ...prev, entries };
    });
  };

  // 受信本体
  const doPullAll = async () => {
    try {
      const json = await pullBatch(USER_ID, getSince(), ["dictionary_entries"]);
      const rows = (json.diffs?.dictionary_entries ?? []) as any[];
      applyEntryDiffs(rows);
      setSince(json.server_time_ms);
    } catch (e) {
      // 静かに失敗（ネットワーク環境などを考慮）
      console.warn("[dictionary] pull-batch failed:", e);
    }
  };

  // 初回マウントで一度だけPULL
  useEffect(() => {
    void doPullAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ホームの「🔄 同期（受信）」/「RESET」の合図を購読
  useEffect(() => {
    const handler = (payload: any) => {
      if (!payload) return;
      if (payload.type === "GLOBAL_SYNC_PULL") {
        void doPullAll();
      } else if (payload.type === "GLOBAL_SYNC_RESET") {
        try { localStorage.setItem(SINCE_KEY, "0"); } catch {}
        // 画面側は保持してもOKだが、混乱しないよう一旦クリアして再取得
        setStore((s) => ({ ...s, entries: [] }));
        void doPullAll();
      }
    };

    // BroadcastChannel
    let bc: BroadcastChannel | undefined;
    try {
      if ("BroadcastChannel" in window) {
        bc = new BroadcastChannel("support-ai-sync");
        bc.onmessage = (e) => handler(e.data);
      }
    } catch {}

    // postMessage
    const onPostMessage = (e: MessageEvent) => handler(e.data);
    window.addEventListener("message", onPostMessage);

    // storage（他タブ由来）
    const onStorage = (e: StorageEvent) => {
      if (e.key === "support-ai:sync:pull:req" && e.newValue) {
        try { handler(JSON.parse(e.newValue)); } catch {}
      }
      if (e.key === "support-ai:sync:reset:req" && e.newValue) {
        try { handler(JSON.parse(e.newValue)); } catch {}
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      try { bc?.close(); } catch {}
      window.removeEventListener("message", onPostMessage);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /* ========= 同期：送信（PUSH） ========= */

  // 単発アップサート
  const pushOne = async (e: Entry, deleted = false) => {
    try {
      const updated_at = Date.now();
      const deviceId = getDeviceId();
      const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      const updated_by = `${isMobile ? "9" : "5"}|${deviceId}`;

      const change = {
        id: e.id,
        updated_at,
        updated_by,
        deleted_at: deleted ? updated_at : null,
        data: deleted
          ? {}
          : {
              term: e.term,
              yomi: e.yomi ?? "",
              meaning: e.meaning,
            },
      };

      await pushBatch({
        user_id: USER_ID,
        device_id: deviceId,
        changes: { dictionary_entries: [change] },
      });

      // サーバ時刻を進めておく（以後のpullで取りこぼさない）
      await doPullAll();
    } catch (err) {
      console.warn("[dictionary] pushOne failed:", err);
    }
  };

  // 全量アップロード（ホームの「☁ 手動アップロード」合図に反応）
  const manualPushAll = async () => {
    try {
      const snapshot = storeRef.current;
      const updated_at = Date.now();
      const deviceId = getDeviceId();
      const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      const updated_by = `${isMobile ? "9" : "5"}|${deviceId}`;

      const changes = snapshot.entries.map((e) => ({
        id: e.id,
        updated_at,
        updated_by,
        deleted_at: null,
        data: { term: e.term, yomi: e.yomi ?? "", meaning: e.meaning },
      }));

      await pushBatch({
        user_id: USER_ID,
        device_id: deviceId,
        changes: { dictionary_entries: changes },
      });

      await doPullAll();
    } catch (e) {
      console.warn("[dictionary] manualPushAll failed:", e);
    }
  };

  // グローバルPush購読
  useEffect(() => {
    const unSub = subscribeGlobalPush((p) => {
      if (!p || p.userId !== USER_ID) return;
      void manualPushAll();
    });
    return () => {
      try { unSub(); } catch {}
    };
  }, []);

  /* ========= CRUD（ローカル更新＋即時PUSH） ========= */

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

    void pushOne(e, false);
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

  // 編集確定
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

    let changed: Entry | null = null;
    setStore((s) => {
      const entries = s.entries.map((x) =>
        x.id === editingId ? (changed = { ...x, term: t, meaning: m, yomi: y, updatedAt: now }) : x
      ) as Entry[];
      return { ...s, entries };
    });
    setEditingId(null);

    if (changed) void pushOne(changed, false);
  };

  // 削除
  const remove = (id: ID) => {
    const target = store.entries.find((e) => e.id === id);
    setStore((s) => ({ ...s, entries: s.entries.filter((x) => x.id !== id) }));
    if (target) void pushOne(target, true);
  };

  // 全削除（※同期テーブルごと一掃はしない）
  const clearAll = () => {
    if (!confirm("全件削除します。よろしいですか？")) return;
    const entries = storeRef.current.entries.slice();
    (async () => {
      for (const e of entries) {
        await pushOne(e, true);
      }
    })();
    setStore({ entries: [], version: 2 });
  };

  // JSON 入出力（ローカルのみ。必要なら全量PUSHボタンで反映可能）
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
        alert("インポートしました。必要ならホームの『☁ 手動アップロード』でクラウドへ反映してください。");
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
