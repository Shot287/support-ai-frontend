"use client";

import { useEffect, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type StoreV1 = {
  content: string;
  updatedAt: number;
  version: 1;
};

type Store = StoreV1;

const LOCAL_KEY = "peer_pressure_v1";
const DOC_KEY = "peer_pressure_v1";

// 手動同期（ホームと同じ）
const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

function createDefaultStore(): Store {
  return {
    content: "",
    updatedAt: Date.now(),
    version: 1,
  };
}

function isStoreV1(x: any): x is StoreV1 {
  return !!x && x.version === 1 && typeof x.content === "string";
}

function migrate(raw: any): Store {
  if (isStoreV1(raw)) {
    return {
      content: raw.content,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
      version: 1,
    };
  }
  return createDefaultStore();
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

export default function PeerPressure() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // localStorage 即時保存（サーバ反映はホーム📥/☁のみ）
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // 手動同期の合図を購読（PULL / PUSH / LOCAL_DOC_APPLIED / storage）
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
        console.warn("[peer-pressure] manual PULL failed:", e);
      }
    };

    const doPush = async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, storeRef.current);
      } catch (e) {
        console.warn("[peer-pressure] manual PUSH failed:", e);
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
            // noop
          } else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            setStore(loadLocal());
          }
        };
      }
    } catch {
      // noop
    }

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
        } catch {
          // noop
        }
      }
      if (ev.key === STORAGE_KEY_RESET_REQ) {
        // noop
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

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setStore((prev) => ({
      ...prev,
      content: e.target.value,
      updatedAt: Date.now(),
    }));
  };

  return (
    <section className="rounded-2xl border p-4 shadow-sm flex flex-col h-[60vh] min-h-[400px]">
      <div className="flex justify-between items-end mb-3">
        <h2 className="font-semibold">宣言ノート</h2>
        <span className="text-[10px] text-gray-500">
          最終更新: {new Date(store.updatedAt).toLocaleString()}
        </span>
      </div>
      <textarea
        className="w-full flex-grow rounded-xl border p-4 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none bg-gray-50/50"
        placeholder="例：今日は統計検定の過去問を3問解く！ / CafeOBJの証明課題を終わらせる！&#13;&#10;（誰かに見られているつもりで、今からやることを宣言しましょう）"
        value={store.content}
        onChange={handleChange}
      />
      <p className="text-xs text-gray-500 mt-3">
        端末ローカルには即時保存、サーバ反映はホームの📥/☁（手動同期）で行われます。
      </p>
    </section>
  );
}