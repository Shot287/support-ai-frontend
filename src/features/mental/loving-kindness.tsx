// src/features/mental/loving-kindness.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";

type Store = {
  content: string;   // 慈悲の瞑想ノート本文
  updatedAt: number; // 最終更新日時
  version: 1;
};

const LOCAL_KEY = "loving_kindness_v1";
const DOC_KEY = "mental_loving_kindness_v1";

// ===== ローカル読み込み / 保存 =====
function loadLocal(): Store {
  try {
    if (typeof window === "undefined") {
      return { content: "", updatedAt: 0, version: 1 };
    }
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { content: "", updatedAt: 0, version: 1 };
    const parsed = JSON.parse(raw) as Partial<Store> | null;
    if (!parsed || typeof parsed !== "object") {
      return { content: "", updatedAt: 0, version: 1 };
    }
    return {
      content: typeof parsed.content === "string" ? parsed.content : "",
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      version: 1,
    };
  } catch {
    return { content: "", updatedAt: 0, version: 1 };
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

// 日時フォーマット
function fmtDateTime(t: number | undefined) {
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
}

// ===== 本体コンポーネント =====
export default function LovingKindness() {
  const [store, setStore] = useState<Store>(() => loadLocal());
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
          const remote = await loadUserDoc<Store>(DOC_KEY);
          if (remote && remote.version === 1) {
            setStore(remote);
            saveLocal(remote);
          }
        } catch (e) {
          console.warn("[loving-kindness] manual PULL failed:", e);
        }
      },
      // ☁ アップロード（ローカル→クラウド）
      push: async () => {
        try {
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        } catch (e) {
          console.warn("[loving-kindness] manual PUSH failed:", e);
        }
      },
      // ⚠ RESET: since 未使用なので特別な処理は不要
      reset: async () => {
        /* no-op */
      },
    });
    return unsubscribe;
  }, []);

  const handleChange = (value: string) => {
    const now = Date.now();
    setStore((s) => ({
      ...s,
      content: value,
      updatedAt: now,
    }));
  };

  return (
    <div className="grid gap-6">
      {/* 説明 */}
      <section className="rounded-2xl border p-4 shadow-sm space-y-3">
        <h2 className="font-semibold mb-1">この機能について</h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          慈悲の瞑想（Loving-Kindness Meditation）は、
          <span className="font-semibold">
            自分や他者に向けて優しさ・幸せを願う言葉を送る
          </span>
          練習です。
          <br />
          ここでは、1枚の大きなノートとして自由に文章を書き残せます。
        </p>
        <p className="text-xs text-gray-600 leading-relaxed">
          例:
          <br />
          ・「私が安全でありますように。心穏やかでありますように。」<br />
          ・「家族が健康で、安心して過ごせますように。」<br />
          ・「自分のことが少しずつでも好きになれますように。」<br />
          <br />
          自分 → 親しい人 → 中立な人 → 苦手な人 → すべての存在、
          という順番で広げていくやり方もあります。
        </p>
        {store.updatedAt ? (
          <p className="text-[11px] text-gray-500">
            最終更新: {fmtDateTime(store.updatedAt)}
          </p>
        ) : (
          <p className="text-[11px] text-gray-400">
            まだ一度も保存されていません。下のノートに書き始めると、自動でローカル保存されます。
          </p>
        )}
        <p className="text-[11px] text-gray-500">
          ※ 内容は端末に自動保存され、ホーム画面の「アップロード／取得」を使うと他の端末とも同期できます。
        </p>
      </section>

      {/* ノート本体 */}
      <section className="rounded-2xl border p-4 shadow-sm space-y-2">
        <h2 className="font-semibold mb-2">慈悲の瞑想ノート</h2>
        <textarea
          value={store.content}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full rounded-xl border px-3 py-2 text-sm leading-relaxed min-h-[320px] whitespace-pre-wrap"
          placeholder={`ここに、慈悲の言葉・祈り・気づいたことなどを自由に書いてください。

例）
・「私が安全でありますように。心穏やかでありますように。」
・「今日一日、自分と他人の両方に少しだけ優しくできますように。」`}
        />
        <p className="text-[11px] text-gray-500 mt-1">
          テキストは入力のたびに自動保存されます。深呼吸しながら、ゆっくり書いてみてください。
        </p>
      </section>
    </div>
  );
}
