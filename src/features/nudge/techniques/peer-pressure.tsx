"use client";

import { useEffect, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

type TaskItem = {
  id: ID;
  title: string;
};

type Peer = {
  id: ID;
  name: string;
  tasks: TaskItem[];
};

type Match = {
  id: ID;
  peerName: string;
  peerTaskTitle: string;
  myTaskTitle: string;
  createdAt: number;
};

type StoreV2 = {
  version: 2;
  myName: string;
  myTasks: TaskItem[];
  peers: Peer[];
  matches: Match[]; // 成立したVSリスト
};

type Store = StoreV2;

const LOCAL_KEY = "peer_pressure_v1"; // キーは維持しつつversionで区別
const DOC_KEY = "peer_pressure_v1";

// 手動同期
const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultStore(): Store {
  return {
    version: 2,
    myName: "",
    myTasks: [],
    peers: [],
    matches: [],
  };
}

function migrate(raw: any): Store {
  if (!raw || typeof raw !== "object") return createDefaultStore();
  
  // v1（単一テキスト）からv2（構造化）への移行時、互換性がないため初期化
  if (raw.version !== 2) {
    return createDefaultStore();
  }

  // v2 のデータ整形
  return {
    version: 2,
    myName: typeof raw.myName === "string" ? raw.myName : "",
    myTasks: Array.isArray(raw.myTasks) ? raw.myTasks : [],
    peers: Array.isArray(raw.peers) ? raw.peers : [],
    matches: Array.isArray(raw.matches) ? raw.matches : [],
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

export default function PeerPressure() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // VS選択待ちのステート
  const [pendingVs, setPendingVs] = useState<{ peerName: string; peerTaskTitle: string } | null>(null);

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

  // --- 操作ハンドラ：自分 ---
  const updateMyName = (name: string) => {
    setStore((s) => ({ ...s, myName: name }));
  };

  const addMyTask = () => {
    const title = prompt("自分が力を入れるタスクを入力してください\n（例：統計検定の過去問を解く）");
    if (!title || !title.trim()) return;
    setStore((s) => ({
      ...s,
      myTasks: [...s.myTasks, { id: uid(), title: title.trim() }],
    }));
  };

  const removeMyTask = (id: string) => {
    setStore((s) => ({ ...s, myTasks: s.myTasks.filter((t) => t.id !== id) }));
  };

  // --- 操作ハンドラ：他人 ---
  const addPeer = () => {
    setStore((s) => ({
      ...s,
      peers: [...s.peers, { id: uid(), name: "", tasks: [] }],
    }));
  };

  const updatePeerName = (peerId: string, name: string) => {
    setStore((s) => ({
      ...s,
      peers: s.peers.map((p) => (p.id === peerId ? { ...p, name } : p)),
    }));
  };

  const removePeer = (peerId: string) => {
    if (!confirm("この人物を削除しますか？")) return;
    setStore((s) => ({ ...s, peers: s.peers.filter((p) => p.id !== peerId) }));
  };

  const addPeerTask = (peerId: string) => {
    const title = prompt("この人が力を入れているタスクを入力してください\n（例：CafeOBJの証明課題）");
    if (!title || !title.trim()) return;
    setStore((s) => ({
      ...s,
      peers: s.peers.map((p) =>
        p.id === peerId
          ? { ...p, tasks: [...p.tasks, { id: uid(), title: title.trim() }] }
          : p
      ),
    }));
  };

  const removePeerTask = (peerId: string, taskId: string) => {
    setStore((s) => ({
      ...s,
      peers: s.peers.map((p) =>
        p.id === peerId
          ? { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) }
          : p
      ),
    }));
  };

  // --- 操作ハンドラ：VS機能 ---
  const handlePeerTaskClick = (peerName: string, taskTitle: string) => {
    if (store.myTasks.length === 0) {
      alert("自分のタスクが登録されていません。まずは一番上に自分のタスクを追加してください！");
      return;
    }
    setPendingVs({ peerName: peerName || "名無し", peerTaskTitle: taskTitle });
  };

  const confirmVsMatch = (myTaskTitle: string) => {
    if (!pendingVs) return;
    const newMatch: Match = {
      id: uid(),
      peerName: pendingVs.peerName,
      peerTaskTitle: pendingVs.peerTaskTitle,
      myTaskTitle,
      createdAt: Date.now(),
    };
    setStore((s) => ({ ...s, matches: [newMatch, ...s.matches] }));
    setPendingVs(null);
  };

  const removeMatch = (matchId: string) => {
    setStore((s) => ({ ...s, matches: s.matches.filter((m) => m.id !== matchId) }));
  };

  return (
    <div className="space-y-6">
      {/* 1. 上段：自分のエリア */}
      <section className="rounded-2xl border-2 border-blue-200 bg-blue-50/30 p-4 shadow-sm relative">
        <h2 className="font-bold text-blue-800 mb-3 flex items-center gap-2">
          <span>👤 自分の陣地</span>
        </h2>
        
        <div className="mb-4">
          <label className="text-xs font-semibold text-blue-700 block mb-1">自分の名前</label>
          <input
            type="text"
            className="w-full sm:w-1/2 rounded-xl border-blue-200 px-3 py-2 text-sm focus:ring-blue-500"
            placeholder="あなたの名前を入力..."
            value={store.myName}
            onChange={(e) => updateMyName(e.target.value)}
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-semibold text-blue-700">力を入れているタスク</label>
            <button
              onClick={addMyTask}
              className="rounded-xl bg-blue-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-blue-700 transition"
            >
              ＋ 追加
            </button>
          </div>
          {store.myTasks.length === 0 ? (
            <div className="text-sm text-gray-500 bg-white/60 p-3 rounded-xl border border-dashed border-blue-200">
              タスクがありません。まずは追加してください。
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {store.myTasks.map((t) => (
                <div key={t.id} className="group relative bg-white border border-blue-200 rounded-xl px-3 py-2 shadow-sm text-sm font-medium flex items-center gap-2">
                  <span>{t.title}</span>
                  <button
                    onClick={() => removeMyTask(t.id)}
                    className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                    title="削除"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* VS待機中のオーバーレイ */}
        {pendingVs && (
          <div className="absolute inset-0 z-10 bg-black/60 rounded-2xl flex flex-col items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md text-center shadow-xl animate-in fade-in zoom-in-95 duration-200">
              <h3 className="text-lg font-bold text-red-600 mb-2">VS 相手が選択されました！</h3>
              <p className="text-sm text-gray-600 mb-4">
                「{pendingVs.peerTaskTitle}」に対抗する、あなたのタスクを選んでください。
              </p>
              <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto">
                {store.myTasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => confirmVsMatch(t.title)}
                    className="border-2 border-blue-500 text-blue-700 font-bold py-2 px-4 rounded-xl hover:bg-blue-50 transition"
                  >
                    {t.title}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setPendingVs(null)}
                className="mt-4 text-xs text-gray-400 hover:text-gray-600 underline"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 2. 中段：VS 闘技場（成立したVS） */}
      {store.matches.length > 0 && (
        <section className="rounded-2xl border-2 border-red-200 bg-red-50/20 p-4 shadow-sm">
          <h2 className="font-bold text-red-700 mb-4 text-center tracking-widest">🔥 BATTLE ARENA 🔥</h2>
          <div className="space-y-3">
            {store.matches.map((m) => (
              <div key={m.id} className="relative bg-white border border-red-100 rounded-xl p-3 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
                {/* 相手側（左） */}
                <div className="flex-1 text-center sm:text-right w-full">
                  <div className="text-[10px] text-gray-500 mb-1">{m.peerName || "名無し"}</div>
                  <div className="font-bold text-gray-800 text-sm">{m.peerTaskTitle}</div>
                </div>
                
                {/* VSマーク（中央） */}
                <div className="flex-shrink-0 font-black text-red-500 text-xl italic px-4">
                  VS
                </div>

                {/* 自分側（右） */}
                <div className="flex-1 text-center sm:text-left w-full">
                  <div className="text-[10px] text-blue-500 mb-1">{store.myName || "自分"}</div>
                  <div className="font-bold text-blue-800 text-sm">{m.myTaskTitle}</div>
                </div>

                {/* 削除ボタン */}
                <button
                  onClick={() => removeMatch(m.id)}
                  className="absolute top-2 right-2 text-gray-300 hover:text-gray-500 transition"
                  title="勝負を取り下げる"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. 下段：他人のエリア */}
      <section className="rounded-2xl border p-4 shadow-sm bg-gray-50/30">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-gray-700">👥 他の人の取り組み</h2>
          <button
            onClick={addPeer}
            className="rounded-xl border bg-white px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 transition"
          >
            ＋ 人物を追加
          </button>
        </div>

        {store.peers.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-6 bg-white rounded-xl border border-dashed">
            他人の情報がありません。「人物を追加」してライバルを作りましょう。
          </div>
        ) : (
          <div className="space-y-4">
            {store.peers.map((peer) => (
              <div key={peer.id} className="grid sm:grid-cols-[200px_1fr] gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                
                {/* 左側：人物名 */}
                <div className="flex flex-col border-b sm:border-b-0 sm:border-r border-gray-100 pb-3 sm:pb-0 sm:pr-4 relative">
                  <label className="text-[10px] font-semibold text-gray-500 mb-1">人物名</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border-gray-200 px-3 py-1.5 text-sm focus:ring-gray-300 font-bold"
                    placeholder="例：ライバルA"
                    value={peer.name}
                    onChange={(e) => updatePeerName(peer.id, e.target.value)}
                  />
                  <button
                    onClick={() => removePeer(peer.id)}
                    className="mt-auto pt-2 text-left text-xs text-red-400 hover:text-red-600 transition"
                  >
                    この人物を削除
                  </button>
                </div>

                {/* 右側：力を入れていること */}
                <div className="flex flex-col">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-semibold text-gray-500">力を入れていること（クリックでVS開始）</label>
                    <button
                      onClick={() => addPeerTask(peer.id)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-semibold"
                    >
                      ＋ タスク追加
                    </button>
                  </div>
                  
                  {peer.tasks.length === 0 ? (
                    <div className="text-xs text-gray-400 mt-2">タスクが登録されていません。</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {peer.tasks.map((t) => (
                        <div key={t.id} className="group relative flex items-center">
                          <button
                            onClick={() => handlePeerTaskClick(peer.name, t.title)}
                            className="bg-gray-100 hover:bg-red-50 hover:text-red-700 hover:border-red-200 border border-transparent rounded-lg px-3 py-1.5 text-sm font-medium transition cursor-pointer"
                            title="クリックして勝負を挑む！"
                          >
                            {t.title}
                          </button>
                          <button
                            onClick={() => removePeerTask(peer.id, t.id)}
                            className="ml-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition absolute -right-4"
                            title="削除"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}