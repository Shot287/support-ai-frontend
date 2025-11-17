// src/features/mental/expressive-writing.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";

type ID = string;

// -, ○, △, × の4状態
// - unknown       : まだ分からない
// - occurred      : 想定より悪かった
// - occurred_ok   : 想定より悪くならなかった
// - not_occurred  : 起こらなかった
export type WorryStatus =
  | "unknown"
  | "occurred"
  | "occurred_ok"
  | "not_occurred";

export type WorryItem = {
  id: ID;
  title: string; // 一言タイトル
  detail: string; // 自由記述（どう心配しているか）
  status: WorryStatus; // -, ○, △, ×
  createdAt: number;
  resolvedAt?: number; // ○ / △ / × になったタイミング
};

type Store = {
  items: WorryItem[];
  version: 1;
};

const LOCAL_KEY = "expressive_writing_v1";
const DOC_KEY = "mental_expressive_writing_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

// ===== ローカル読み込み / 保存 =====
function loadLocal(): Store {
  try {
    if (typeof window === "undefined") return { items: [], version: 1 };
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { items: [], version: 1 };
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || typeof parsed !== "object") return { items: [], version: 1 };
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      version: 1,
    };
  } catch {
    return { items: [], version: 1 };
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

// ステータスから表示用のラベルと説明を返す
function statusToLabel(status: WorryStatus) {
  if (status === "occurred") return "○"; // 想定より悪かった
  if (status === "occurred_ok") return "△"; // 想定より悪くなかった
  if (status === "not_occurred") return "×"; // 起こらなかった
  return "-"; // まだ分からない
}

function statusToDescription(status: WorryStatus) {
  if (status === "occurred") return "想定より悪かった";
  if (status === "occurred_ok") return "想定より悪くならなかった";
  if (status === "not_occurred") return "起こらなかった";
  return "まだ分からない";
}

// サマリー用のテキスト
function summaryText(
  total: number,
  bad: number,
  notBad: number,
  notOccurred: number
) {
  if (total === 0) {
    return "まだデータがありません。心配事を書き出して、実際どうなったかを記録してみましょう。";
  }

  const resolved = bad + notBad + notOccurred;
  if (resolved === 0) {
    return `登録 ${total} 件のうち、まだ結果が分かっているものはありません。時間が経ったら ○ / △ / × を付けていきましょう。`;
  }

  const trueBadRate = Math.round((bad / resolved) * 100);
  const notSoBadRate = Math.round(((notBad + notOccurred) / resolved) * 100);

  return `これまでに結果が分かった ${resolved} 件の心配事のうち、想定より悪かったのは約 ${trueBadRate}%、起こらなかった・想定より悪くならなかったものは約 ${notSoBadRate}% でした。`;
}

// ===== 本体コンポーネント =====
export default function ExpressiveWriting() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // 追加フォーム
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");

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
          const remote = await loadUserDoc<Store>(DOC_KEY);
          if (remote && remote.version === 1) {
            setStore(remote);
            saveLocal(remote);
          }
        } catch (e) {
          console.warn("[expressive-writing] manual PULL failed:", e);
        }
      },
      // ☁ アップロード（ローカル→クラウド）
      push: async () => {
        try {
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        } catch (e) {
          console.warn("[expressive-writing] manual PUSH failed:", e);
        }
      },
      // ⚠ RESET: since 未使用なので特別な処理は不要
      reset: async () => {
        /* no-op */
      },
    });
    return unsubscribe;
  }, []);

  // ===== 追加 =====
  const addItem = () => {
    const t = title.trim();
    const d = detail.trim();
    if (!t && !d) {
      alert("タイトルか本文のどちらかは入力してください。");
      return;
    }
    const now = Date.now();
    const item: WorryItem = {
      id: uid(),
      title: t || "（タイトルなし）",
      detail: d,
      status: "unknown",
      createdAt: now,
    };
    setStore((s) => ({
      ...s,
      items: [item, ...s.items],
    }));
    setTitle("");
    setDetail("");
  };

  // ===== ステータス変更（-, ○, △, × をループ） =====
  const cycleStatus = (id: ID) => {
    const now = Date.now();
    setStore((s) => {
      const items = s.items.map((it) => {
        if (it.id !== id) return it;

        let next: WorryStatus;
        if (it.status === "unknown") {
          // - → ○（想定より悪かった）
          next = "occurred";
        } else if (it.status === "occurred") {
          // ○ → △（想定より悪くなかった）
          next = "occurred_ok";
        } else if (it.status === "occurred_ok") {
          // △ → ×（起こらなかった）
          next = "not_occurred";
        } else {
          // × → -（まだ分からない） に戻る
          next = "unknown";
        }

        if (next === "unknown") {
          // 未確定に戻した場合は resolvedAt を消す
          const { resolvedAt, ...rest } = it;
          return { ...rest, status: next };
        } else if (it.status === "unknown") {
          // 未確定 → 確定 になった瞬間に resolvedAt を記録
          return { ...it, status: next, resolvedAt: now };
        } else {
          // 確定 → 別の確定ステータス（○↔△↔×）は resolvedAt を維持
          return { ...it, status: next };
        }
      });
      return { ...s, items };
    });
  };

  // ===== 削除 =====
  const removeItem = (id: ID) => {
    if (!confirm("この項目を削除します。よろしいですか？")) return;
    setStore((s) => ({
      ...s,
      items: s.items.filter((it) => it.id !== id),
    }));
  };

  // ===== リスト & サマリー =====
  const sortedItems = useMemo(
    () => [...store.items].sort((a, b) => b.createdAt - a.createdAt),
    [store.items]
  );

  const stats = useMemo(() => {
    const total = store.items.length;
    let unknown = 0;
    let bad = 0;
    let notBad = 0;
    let notOccurred = 0;
    for (const it of store.items) {
      if (it.status === "unknown") unknown++;
      else if (it.status === "occurred") bad++;
      else if (it.status === "occurred_ok") notBad++;
      else if (it.status === "not_occurred") notOccurred++;
    }
    return { total, unknown, bad, notBad, notOccurred };
  }, [store.items]);

  const fmtDateTime = (t: number | undefined) => {
    if (!t) return "";
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(t));
  };

  return (
    <div className="grid gap-6">
      {/* 説明＋サマリー */}
      <section className="rounded-2xl border p-4 shadow-sm space-y-3">
        <h2 className="font-semibold mb-1">この機能について</h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          心配事の{" "}
          <span className="font-semibold">
            ほとんどは起こらないか、起こっても想像より悪くない
          </span>
          と言われています。
          <br />
          ここでは、今抱えている不安を書き出しておき、あとから
          「実際どうなったか？」を
          <span className="font-semibold"> ○ / △ / × / - </span>
          で記録します。
        </p>
        <div className="rounded-xl bg-gray-50 border px-3 py-2 text-xs text-gray-700 space-y-1">
          <div>
            <span className="inline-flex w-6 justify-center font-semibold mr-1">
              -
            </span>
            : まだ分からない
          </div>
          <div>
            <span className="inline-flex w-6 justify-center font-semibold mr-1">
              ○
            </span>
            : 想定より悪かった
          </div>
          <div>
            <span className="inline-flex w-6 justify中心 font-semibold mr-1">
              △
            </span>
            : 想定より悪くならなかった
          </div>
          <div>
            <span className="inline-flex w-6 justify-center font-semibold mr-1">
              ×
            </span>
            : 起こらなかった
          </div>
        </div>
        <div className="mt-2 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-900">
          <div className="font-semibold mb-1">サマリー</div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] mb-1">
            <span>登録: {stats.total} 件</span>
            <span> / -: {stats.unknown}</span>
            <span> / ○: {stats.bad}</span>
            <span> / △: {stats.notBad}</span>
            <span> / ×: {stats.notOccurred}</span>
          </div>
          <p>
            {summaryText(
              stats.total,
              stats.bad,
              stats.notBad,
              stats.notOccurred
            )}
          </p>
        </div>
      </section>

      {/* 追加フォーム */}
      <section className="rounded-2xl border p-4 shadow-sm space-y-3">
        <h2 className="font-semibold mb-2">心配事を書き出す</h2>
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border px-3 py-2 text-sm"
            placeholder="一言タイトル（例：統計の期末テスト／バイトのシフト／友達との約束 など）"
          />
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            className="w-full rounded-xl border px-3 py-2 text-sm leading-relaxed"
            rows={4}
            placeholder="今、不安に思っていることをそのまま書いてください。最悪どうなりそうか、何が一番怖いのか、など自由に書いて大丈夫です。"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
          <button
            type="button"
            onClick={addItem}
            className="rounded-xl bg-black px-5 py-2 text-sm text-white font-semibold"
          >
            追加
          </button>
          <p className="text-xs text-gray-500">
            ※ 追加した心配事は下の一覧に表示されます。
          </p>
        </div>
      </section>

      {/* 一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        {sortedItems.length === 0 ? (
          <p className="text-sm text-gray-500">
            まだ心配事は登録されていません。
            <br />
            上のフォームから、今気になっていることを一つだけでも書き出してみましょう。
          </p>
        ) : (
          <ul className="space-y-2">
            {sortedItems.map((it) => (
              <li
                key={it.id}
                className="rounded-xl border px-3 py-2 text-sm bg-white flex flex-col gap-2"
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => cycleStatus(it.id)}
                    className={
                      "mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full border text-sm font-semibold transition " +
                      (it.status === "unknown"
                        ? "bg-gray-50 text-gray-500 border-gray-300 hover:bg-gray-100"
                        : it.status === "occurred"
                        ? "bg-red-50 text-red-700 border-red-300 hover:bg-red-100"
                        : it.status === "occurred_ok"
                        ? "bg-green-50 text-green-700 border-green-300 hover:bg-green-100"
                        : // not_occurred
                          "bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100")
                    }
                    title={statusToDescription(it.status)}
                  >
                    {statusToLabel(it.status)}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold break-words">
                        {it.title}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(it.id)}
                        className="text-xs rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                      >
                        削除
                      </button>
                    </div>
                    {it.detail && (
                      <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap break-words">
                        {it.detail}
                      </p>
                    )}
                    <div className="mt-1 text-[11px] text-gray-500 space-x-2">
                      <span>登録: {fmtDateTime(it.createdAt)}</span>
                      {it.resolvedAt && (
                        <span>／ 結果判明: {fmtDateTime(it.resolvedAt)}</span>
                      )}
                      <span>／ 状態: {statusToDescription(it.status)}</span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
