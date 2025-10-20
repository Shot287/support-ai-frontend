// src/app/nudge/work-log/manage/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../../../lib/api";

/* ===================== 型 ===================== */
type ID = string;

type Group = {
  id: ID;
  name: string;
  color?: string;
  createdAt: number;
  serverId?: string;
};

type Card = {
  id: ID;
  groupId: ID;
  name: string;
  color?: string;
  createdAt: number;
  serverId?: string;
};

type StoreShape = {
  groups: Group[];
  cards: Card[];
  sessions: unknown[]; // 本ページでは未使用（互換のため保持）
  version: 1;
};

// Server types
interface ServerGroup {
  id: string;
  name: string;
  color?: string;
  created_at?: string;
  user_id?: string;
}
interface ServerCard {
  id: string;
  group_id: string;
  name: string;
  color?: string;
  created_at?: string;
  user_id?: string;
}

/* ===================== 定数/ユーティリティ ===================== */
const STORE_KEY = "worklog_v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function loadStore(): StoreShape {
  try {
    const raw =
      typeof window !== "undefined" ? localStorage.getItem(STORE_KEY) : null;
    if (!raw) return { groups: [], cards: [], sessions: [], version: 1 };
    const parsed = JSON.parse(raw) as StoreShape;
    if (!parsed.version) throw new Error("invalid store");
    return parsed;
  } catch {
    return { groups: [], cards: [], sessions: [], version: 1 };
  }
}
function saveStore(s: StoreShape) {
  if (typeof window !== "undefined")
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

function pickColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 80% 45%)`;
}

function errorToString(err: unknown) {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/* ===================== サーバ同期ヘルパ ===================== */
async function ensureGroupOnServer(group: Group): Promise<string> {
  if (group.serverId) return group.serverId;
  await apiPost(`/nudge/work-log/groups`, {
    name: group.name,
    color: group.color,
  });
  const serverGroups = await apiGet<ServerGroup[]>(`/nudge/work-log/groups`);
  const matched = serverGroups.filter((g) => g?.name === group.name);
  const picked = matched.length > 0 ? matched[matched.length - 1] : undefined;
  const serverId = picked?.id;
  if (!serverId) throw new Error("サーバ側グループIDの特定に失敗しました");
  return serverId;
}

async function ensureCardOnServer(
  card: Card,
  parentGroup: Group
): Promise<string> {
  if (card.serverId) return card.serverId;
  const groupServerId = await ensureGroupOnServer(parentGroup);
  await apiPost(`/nudge/work-log/cards`, {
    group_id: groupServerId,
    name: card.name,
    color: card.color,
  });
  const serverCards = await apiGet<ServerCard[]>(
    `/nudge/work-log/cards?group_id=${encodeURIComponent(groupServerId)}`
  );
  const found =
    serverCards.find((c) => c?.name === card.name) ??
    serverCards[serverCards.length - 1];
  const serverId = found?.id;
  if (!serverId) throw new Error("サーバ側カードIDの特定に失敗しました");
  return serverId;
}

/* ===================== ページ本体 ===================== */
export default function ManageWorkLog() {
  const [store, setStore] = useState<StoreShape>(() => loadStore());
  const [selectedGroupId, setSelectedGroupId] = useState<ID | "">("");

  // 入力用
  const [groupName, setGroupName] = useState("");
  const [cardName, setCardName] = useState("");

  // 編集用
  const [renamingGroupId, setRenamingGroupId] = useState<ID | null>(null);
  const [renamingCardId, setRenamingCardId] = useState<ID | null>(null);
  const [tmpName, setTmpName] = useState("");

  useEffect(() => saveStore(store), [store]);

  const groupMap = useMemo(
    () => Object.fromEntries(store.groups.map((g) => [g.id, g])),
    [store.groups]
  );
  const cardsInSelected = useMemo(
    () =>
      store.cards.filter((c) =>
        !selectedGroupId ? true : c.groupId === selectedGroupId
      ),
    [store.cards, selectedGroupId]
  );

  /* ---------- 追加/更新/削除 ---------- */
  const addGroup = async () => {
    const name = groupName.trim();
    if (!name) return;
    const local: Group = {
      id: uid(),
      name,
      color: pickColor(name),
      createdAt: Date.now(),
    };
    setStore((s) => ({ ...s, groups: [...s.groups, local] }));
    setGroupName("");
    if (!selectedGroupId) setSelectedGroupId(local.id);

    try {
      const serverId = await ensureGroupOnServer(local);
      setStore((s) => ({
        ...s,
        groups: s.groups.map((g) =>
          g.id === local.id ? { ...g, serverId } : g
        ),
      }));
    } catch (e) {
      console.error("group sync failed", e);
      alert(
        "グループのサーバ登録に失敗しました。ネットワークや認証(x-token)をご確認ください。"
      );
    }
  };

  const renameGroup = (id: ID) => {
    const g = groupMap[id];
    if (!g) return;
    setRenamingGroupId(id);
    setTmpName(g.name);
  };
  const commitRenameGroup = () => {
    if (!renamingGroupId) return;
    const name = tmpName.trim();
    if (!name) return;
    setStore((s) => ({
      ...s,
      groups: s.groups.map((g) =>
        g.id === renamingGroupId
          ? { ...g, name, color: pickColor(name) }
          : g
      ),
    }));
    setRenamingGroupId(null);
    setTmpName("");
  };
  const deleteGroup = (id: ID) => {
    const g = groupMap[id];
    if (!g) return;
    const count = store.cards.filter((c) => c.groupId === id).length;
    if (
      !confirm(
        `グループ「${g.name}」を削除します。所属カード ${count} 件も削除されます。よろしいですか？`
      )
    )
      return;
    setStore((s) => ({
      ...s,
      groups: s.groups.filter((x) => x.id !== id),
      cards: s.cards.filter((x) => x.groupId !== id),
    }));
    if (selectedGroupId === id) setSelectedGroupId("");
  };

  const addCard = async () => {
    if (!selectedGroupId) return;
    const name = cardName.trim();
    if (!name) return;
    const local: Card = {
      id: uid(),
      groupId: selectedGroupId as ID,
      name,
      color: pickColor(name),
      createdAt: Date.now(),
    };
    setStore((s) => ({ ...s, cards: [...s.cards, local] }));
    setCardName("");

    try {
      const parent = groupMap[selectedGroupId as string];
      if (!parent) throw new Error("group not found");
      const serverId = await ensureCardOnServer(local, parent);
      setStore((s) => ({
        ...s,
        cards: s.cards.map((c) =>
          c.id === local.id ? { ...c, serverId } : c
        ),
      }));
    } catch (e) {
      console.error("card sync failed", e);
      alert(
        "カードのサーバ登録に失敗しました。ネットワークや認証(x-token)をご確認ください。"
      );
    }
  };

  const renameCard = (id: ID) => {
    const c = store.cards.find((x) => x.id === id);
    if (!c) return;
    setRenamingCardId(id);
    setTmpName(c.name);
  };
  const commitRenameCard = () => {
    if (!renamingCardId) return;
    const name = tmpName.trim();
    if (!name) return;
    setStore((s) => ({
      ...s,
      cards: s.cards.map((c) =>
        c.id === renamingCardId
          ? { ...c, name, color: pickColor(name) }
          : c
      ),
    }));
    setRenamingCardId(null);
    setTmpName("");
  };
  const deleteCard = (id: ID) => {
    const c = store.cards.find((x) => x.id === id);
    if (!c) return;
    if (!confirm(`カード「${c.name}」を削除します。よろしいですか？`)) return;
    setStore((s) => ({ ...s, cards: s.cards.filter((x) => x.id !== id) }));
  };

  const resyncMissing = async () => {
    // 未同期のグループ/カードを一括同期
    try {
      // groups
      for (const g of store.groups) {
        if (!g.serverId) {
          const sid = await ensureGroupOnServer(g);
          setStore((s) => ({
            ...s,
            groups: s.groups.map((x) =>
              x.id === g.id ? { ...x, serverId: sid } : x
            ),
          }));
        }
      }
      // cards
      for (const c of store.cards) {
        if (!c.serverId) {
          const parent = groupMap[c.groupId];
          if (!parent) continue;
          const sid = await ensureCardOnServer(c, parent);
          setStore((s) => ({
            ...s,
            cards: s.cards.map((x) =>
              x.id === c.id ? { ...x, serverId: sid } : x
            ),
          }));
        }
      }
      alert("未同期データの同期が完了しました。");
    } catch (e) {
      console.error("resync error", e);
      alert(`同期に失敗しました: ${errorToString(e)}`);
    }
  };

  /* ---------- 描画 ---------- */
  return (
    // ✅ この管理ページも横方向に広がる可能性があるため、必要時に横スク有効化
    <div className="x-scroll">
      <main className="app-width-guard minw-720">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">カードグループ／カード管理</h1>
          <Link
            href="/nudge/work-log"
            className="rounded-xl border px-4 py-2 hover:bg-gray-50"
          >
            ← 作業記録へ戻る
          </Link>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {/* 左：グループ管理 */}
          <section className="rounded-2xl border p-4 shadow-sm">
            <h2 className="font-semibold mb-3">グループ</h2>

            <div className="flex gap-2">
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="例: TOEIC"
                className="w-full rounded-xl border px-3 py-3"
                aria-label="グループ名"
              />
              <button
                onClick={addGroup}
                className="rounded-xl border px-4 py-3 hover:bg-gray-50"
              >
                追加
              </button>
            </div>

            <ul className="mt-4 space-y-2">
              {store.groups
                .slice()
                .sort((a, b) => a.createdAt - b.createdAt)
                .map((g) => {
                  const count = store.cards.filter(
                    (c) => c.groupId === g.id
                  ).length;
                  const isEditing = renamingGroupId === g.id;
                  return (
                    <li key={g.id} className="rounded-xl border px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-3 w-3 rounded-full"
                              style={{ background: g.color }}
                            />
                            {!isEditing ? (
                              <>
                                <span className="font-medium truncate">
                                  {g.name}
                                </span>
                                <span className="text-xs text-gray-500">
                                  ({count}) {g.serverId ? "" : "未同期"}
                                </span>
                              </>
                            ) : (
                              <input
                                autoFocus
                                value={tmpName}
                                onChange={(e) => setTmpName(e.target.value)}
                                className="rounded-lg border px-2 py-1 text-sm"
                              />
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => setSelectedGroupId(g.id)}
                            className={`rounded-lg border px-2 py-1 text-sm ${
                              selectedGroupId === g.id ? "bg-gray-100" : ""
                            }`}
                          >
                            選択
                          </button>
                          {!isEditing ? (
                            <>
                              <button
                                onClick={() => renameGroup(g.id)}
                                className="rounded-lg border px-2 py-1 text-sm"
                              >
                                名称変更
                              </button>
                              <button
                                onClick={() => deleteGroup(g.id)}
                                className="rounded-lg border px-2 py-1 text-sm"
                              >
                                削除
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={commitRenameGroup}
                                className="rounded-lg border px-2 py-1 text-sm"
                              >
                                保存
                              </button>
                              <button
                                onClick={() => {
                                  setRenamingGroupId(null);
                                  setTmpName("");
                                }}
                                className="rounded-lg border px-2 py-1 text-sm"
                              >
                                取消
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>
          </section>

          {/* 右：カード管理 */}
          <section className="rounded-2xl border p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">カード</h2>
              <div className="text-sm text-gray-600">
                {selectedGroupId
                  ? `対象: ${groupMap[selectedGroupId]?.name ?? "?"}`
                  : "対象: すべて"}
              </div>
            </div>

            <div className="flex gap-2">
              <input
                value={cardName}
                onChange={(e) => setCardName(e.target.value)}
                placeholder="例: 単語 / 文法"
                className="w-full rounded-xl border px-3 py-3"
                aria-label="カード名"
              />
              <button
                onClick={addCard}
                disabled={!selectedGroupId}
                className="rounded-xl border px-4 py-3 hover:bg-gray-50 disabled:opacity-40"
                title={!selectedGroupId ? "先にグループを選択してください" : ""}
              >
                追加
              </button>
            </div>

            <ul className="mt-4 space-y-2">
              {cardsInSelected
                .slice()
                .sort((a, b) => a.createdAt - b.createdAt)
                .map((c) => {
                  const isEditing = renamingCardId === c.id;
                  return (
                    <li key={c.id} className="rounded-xl border px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ background: c.color }}
                          />
                          {!isEditing ? (
                            <>
                              <span className="font-medium truncate">
                                {c.name}
                              </span>
                              <span className="text-xs text-gray-500">
                                （{groupMap[c.groupId]?.name ?? "—"}）
                                {c.serverId ? "" : " 未同期"}
                              </span>
                            </>
                          ) : (
                            <input
                              autoFocus
                              value={tmpName}
                              onChange={(e) => setTmpName(e.target.value)}
                              className="rounded-lg border px-2 py-1 text-sm"
                            />
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {!isEditing ? (
                            <>
                              <button
                                onClick={() => renameCard(c.id)}
                                className="rounded-lg border px-2 py-1 text-sm"
                              >
                                名称変更
                              </button>
                              <button
                                onClick={() => deleteCard(c.id)}
                                className="rounded-lg border px-2 py-1 text-sm"
                              >
                                削除
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={commitRenameCard}
                                className="rounded-lg border px-2 py-1 text-sm"
                              >
                                保存
                              </button>
                              <button
                                onClick={() => {
                                  setRenamingCardId(null);
                                  setTmpName("");
                                }}
                                className="rounded-lg border px-2 py-1 text-sm"
                              >
                                取消
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>
          </section>
        </div>

        {/* 一括操作 */}
        <section className="rounded-2xl border p-4 shadow-sm mt-6">
          <h2 className="font-semibold mb-3">同期／その他</h2>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={resyncMissing}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              未同期を一括同期
            </button>
            <button
              onClick={() => {
                if (
                  !confirm(
                    "ローカルのグループ・カードを全消去します。よろしいですか？（サーバには影響しません）"
                  )
                )
                  return;
                setStore({ groups: [], cards: [], sessions: [], version: 1 });
                setSelectedGroupId("");
              }}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              ローカルを初期化
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
