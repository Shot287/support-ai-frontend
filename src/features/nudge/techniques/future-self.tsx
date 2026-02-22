"use client";

import { useEffect, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

type Goal = {
  id: ID;
  title: string;
  goodFuture: string;
  failureResult: string; // 具体的な点数や結果
  worstScenario: string; // 最悪な状況
  createdAt: number;
};

type StoreV1 = {
  version: 1;
  goals: Goal[];
};

type Store = StoreV1;

const LOCAL_KEY = "future_self_v1";
const DOC_KEY = "future_self_v1";

// 手動同期
const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultStore(): Store {
  return {
    version: 1,
    goals: [],
  };
}

function migrate(raw: any): Store {
  if (!raw || typeof raw !== "object") return createDefaultStore();
  if (raw.version !== 1) return createDefaultStore();

  return {
    version: 1,
    goals: Array.isArray(raw.goals) ? raw.goals : [],
  };
}

function loadLocal(): Store {
  try {
    if (typeof window === "undefined") return createDefaultStore();
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createDefaultStore();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch {
    return createDefaultStore();
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

// 自動で高さが拡張されるテキストエリアコンポーネント
interface AutoResizeTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
}

const AutoResizeTextarea: React.FC<AutoResizeTextareaProps> = ({ value, className, ...props }) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      // 高さを一旦autoにしてからスクロールの高さに合わせることで、自動リサイズを実現
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      // スクロールバーを隠し、手動リサイズを無効化
      className={`${className} overflow-hidden resize-none`}
      {...props}
    />
  );
};

export default function FutureSelf() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // localStorage 即時保存
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // 手動同期購読
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<any>(DOC_KEY);
        if (!remote) return;
        const next = migrate(remote);
        setStore(next);
        saveLocal(next);
      } catch (e) {
        console.warn("[future-self] manual PULL failed:", e);
      }
    };

    const doPush = async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, storeRef.current);
      } catch (e) {
        console.warn("[future-self] manual PUSH failed:", e);
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
          else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            setStore(loadLocal());
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
        try {
          setStore(migrate(JSON.parse(ev.newValue)));
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      try { bc?.close(); } catch {}
      window.removeEventListener("message", onWinMsg);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // --- 操作ハンドラ ---
  const addGoal = () => {
    const title = prompt("大学卒業までに達成したい目標を入力してください\n（例：TOEIC 850点取得、〇〇資格合格）");
    if (!title || !title.trim()) return;
    const newGoal: Goal = {
      id: uid(),
      title: title.trim(),
      goodFuture: "",
      failureResult: "",
      worstScenario: "",
      createdAt: Date.now(),
    };
    setStore((s) => ({ ...s, goals: [...s.goals, newGoal] }));
  };

  const removeGoal = (id: string) => {
    if (!confirm("この目標を削除しますか？（付随する未来のシナリオも全て消去されます）")) return;
    setStore((s) => ({ ...s, goals: s.goals.filter((g) => g.id !== id) }));
  };

  const updateGoalField = (id: string, field: keyof Goal, value: string) => {
    setStore((s) => ({
      ...s,
      goals: s.goals.map((g) => (g.id === id ? { ...g, [field]: value } : g)),
    }));
  };

  return (
    <div className="space-y-8 pb-10">
      
      {/* 1. 上段：目標リスト */}
      <section className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/30 p-4 sm:p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-bold text-indigo-800 flex items-center gap-2">
              <span>🎓 卒業時の目標</span>
            </h2>
            <p className="text-xs text-indigo-600 mt-1">大学卒業までに必ず達成したいことをリストアップしましょう。</p>
          </div>
          <button
            onClick={addGoal}
            className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700 transition shadow-sm"
          >
            ＋ 目標を追加
          </button>
        </div>

        {store.goals.length === 0 ? (
          <div className="text-sm text-gray-500 bg-white/60 p-4 rounded-xl border border-dashed border-indigo-200 text-center">
            まだ目標がありません。まずは追加してください。
          </div>
        ) : (
          <div className="space-y-3">
            {store.goals.map((g, idx) => (
              <div key={g.id} className="flex items-center gap-3 bg-white border border-indigo-100 rounded-xl p-3 shadow-sm">
                <span className="font-bold text-indigo-400 w-6 text-center">{idx + 1}.</span>
                <input
                  type="text"
                  className="flex-grow font-bold text-gray-800 bg-transparent border-none p-0 focus:ring-0 text-sm sm:text-base"
                  value={g.title}
                  onChange={(e) => updateGoalField(g.id, "title", e.target.value)}
                  placeholder="目標を入力..."
                />
                <button
                  onClick={() => removeGoal(g.id)}
                  className="text-gray-300 hover:text-red-500 transition px-2"
                  title="削除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. 中段：達成した最高の未来 */}
      {store.goals.length > 0 && (
        <section className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/30 p-4 sm:p-6 shadow-sm">
          <h2 className="text-lg font-bold text-emerald-700 flex items-center gap-2 mb-2">
            <span>✨ 達成した最高の未来</span>
          </h2>
          <p className="text-xs text-emerald-600 mb-6">
            その目標を達成したとき、どんないい未来が待っていますか？得られる感情、周囲の反応、就活での無双具合など、ワクワクする結果を具体的に書き出してください。
          </p>
          
          <div className="space-y-6">
            {store.goals.map((g) => (
              <div key={`good-${g.id}`} className="bg-white rounded-xl border border-emerald-100 p-4 shadow-sm">
                <div className="font-bold text-gray-800 mb-2 border-b border-emerald-50 pb-2">
                  <span className="text-emerald-500 mr-2">▶</span>{g.title}
                </div>
                <AutoResizeTextarea
                  className="w-full rounded-lg border-emerald-100 bg-emerald-50/30 px-3 py-2 text-sm focus:ring-emerald-500 focus:border-emerald-500 min-h-[80px]"
                  placeholder="例：第一志望の企業から内定をもらい、親も喜んでくれた！自信に満ち溢れている。"
                  value={g.goodFuture}
                  onChange={(e) => updateGoalField(g.id, "goodFuture", e.target.value)}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. 下段：失敗した最悪の現実 */}
      {store.goals.length > 0 && (
        <section className="rounded-2xl border-2 border-red-200 bg-red-50/20 p-4 sm:p-6 shadow-sm">
          <h2 className="text-lg font-bold text-red-700 flex items-center gap-2 mb-2">
            <span>💀 失敗した最悪の現実</span>
          </h2>
          <p className="text-xs text-red-600 mb-6">
            先延ばしにし続けた結果、達成できなかった未来です。「具体的な失敗の数値・結果」と、「その後の最悪な状況」をリアルに突きつけてください。
          </p>

          <div className="space-y-6">
            {store.goals.map((g) => (
              <div key={`bad-${g.id}`} className="bg-white rounded-xl border border-red-100 p-4 shadow-sm space-y-4">
                <div className="font-bold text-gray-800 border-b border-red-50 pb-2">
                  <span className="text-red-500 mr-2">▶</span>{g.title}
                </div>
                
                <div className="grid sm:grid-cols-2 gap-4">
                  {/* 具体的な失敗結果 */}
                  <div>
                    <label className="block text-xs font-bold text-red-600 mb-1">📉 具体的な失敗の結果・点数</label>
                    <AutoResizeTextarea
                      className="w-full rounded-lg border-red-100 bg-red-50/30 px-3 py-2 text-sm focus:ring-red-500 focus:border-red-500 min-h-[80px]"
                      placeholder="例：TOEIC 400点で足切り。GPA 1.2で留年ギリギリ。"
                      value={g.failureResult}
                      onChange={(e) => updateGoalField(g.id, "failureResult", e.target.value)}
                    />
                  </div>

                  {/* 最悪な状況 */}
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">真っ暗な状況・周囲の目</label>
                    <AutoResizeTextarea
                      className="w-full rounded-lg border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:ring-gray-400 focus:border-gray-400 min-h-[80px]"
                      placeholder="例：周りは次々と内定をもらう中、自分だけ無い内定。親には呆れられ、毎日焦りと自己嫌悪で眠れない。"
                      value={g.worstScenario}
                      onChange={(e) => updateGoalField(g.id, "worstScenario", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}