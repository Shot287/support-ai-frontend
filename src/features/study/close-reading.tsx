// src/features/study/close-reading.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type Role =
  | "S"
  | "V"
  | "O"
  | "C"
  | "M"
  | "SV"
  | "VC"
  | "VO"
  | "VOM"
  | "OTHER"
  | "NONE";

type Token = {
  id: string;
  text: string;
  // v1互換のため残す（v2では表示/編集の主役は group）
  role?: Role;
};

type Group = {
  id: string;
  tokenIds: string[]; // 順序は tokens の並び順に合わせて保存
  role: Role; // グループの役割（表示は1つだけ）
};

type StoreV1 = {
  version: 1;
  inputText: string;
  tokens: { id: string; text: string; role: Role }[];
  updatedAt: number;
};

type StoreV2 = {
  version: 2;
  inputText: string;
  tokens: Token[];
  groups: Group[]; // ★追加：まとまり
  updatedAt: number;
};

type Store = StoreV2;

const LOCAL_KEY = "study_close_reading_v1";
const DOC_KEY = "study_close_reading_v1";

const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

// 役割の表示名（必要なら増やしてOK）
const ROLE_LABELS: { role: Role; label: string }[] = [
  { role: "S", label: "S（主語）" },
  { role: "V", label: "V（動詞）" },
  { role: "O", label: "O（目的語）" },
  { role: "C", label: "C（補語）" },
  { role: "M", label: "M（修飾）" },
  { role: "SV", label: "SV（主語＋動詞）" },
  { role: "VO", label: "VO（動詞＋目的語）" },
  { role: "VC", label: "VC（動詞＋補語）" },
  { role: "VOM", label: "VOM（動詞＋目的語＋修飾など）" },
  { role: "OTHER", label: "その他" },
  { role: "NONE", label: "未設定" },
];

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * 英文を「単語/記号」単位に分割して Token 化
 * - 句読点 .,!?;:() などは別トークン
 * - 空白は捨てる
 */
function tokenize(text: string): Token[] {
  const re = /[A-Za-z]+(?:'[A-Za-z]+)?|\d+(?:\.\d+)?|[^\sA-Za-z0-9]/g;
  const raw = text.match(re) ?? [];
  return raw.map((t) => ({
    id: newId(),
    text: t,
    role: "NONE",
  }));
}

function defaultStoreV2(): StoreV2 {
  return {
    version: 2,
    inputText: "",
    tokens: [],
    groups: [],
    updatedAt: Date.now(),
  };
}

function safeParseJSON<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function isWordToken(t: string) {
  return /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(t) || /^\d+(?:\.\d+)?$/.test(t);
}

function classForRole(role: Role) {
  switch (role) {
    case "S":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "V":
      return "bg-red-100 text-red-800 border-red-200";
    case "O":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "C":
      return "bg-purple-100 text-purple-800 border-purple-200";
    case "M":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "SV":
    case "VO":
    case "VC":
    case "VOM":
      return "bg-slate-100 text-slate-800 border-slate-200";
    case "OTHER":
      return "bg-gray-100 text-gray-800 border-gray-200";
    case "NONE":
    default:
      return "bg-white text-gray-700 border-gray-200";
  }
}

function roleShort(role: Role) {
  if (role === "NONE") return "";
  return role;
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

/** tokens配列の順序で tokenIds を並べ替える */
function sortTokenIdsByTokenOrder(tokenIds: string[], tokens: Token[]) {
  const idx = new Map(tokens.map((t, i) => [t.id, i]));
  return [...tokenIds].sort((a, b) => (idx.get(a) ?? 1e9) - (idx.get(b) ?? 1e9));
}

/** v1 -> v2 変換：token.roleが付いていたものは「1語グループ」にする */
function migrate(raw: any): StoreV2 {
  const base = defaultStoreV2();
  if (!raw || typeof raw !== "object") return base;

  // v2
  if (raw.version === 2) {
    const inputText = typeof raw.inputText === "string" ? raw.inputText : "";
    const tokens: Token[] = Array.isArray(raw.tokens)
      ? raw.tokens
          .map((x: any) => {
            if (!x || typeof x !== "object") return null;
            const text = typeof x.text === "string" ? x.text : null;
            if (!text) return null;
            return {
              id: typeof x.id === "string" ? x.id : newId(),
              text,
              role: typeof x.role === "string" ? (x.role as Role) : "NONE",
            };
          })
          .filter(Boolean) as Token[]
      : [];

    const groups: Group[] = Array.isArray(raw.groups)
      ? raw.groups
          .map((g: any) => {
            if (!g || typeof g !== "object") return null;
            const role = typeof g.role === "string" ? (g.role as Role) : "NONE";
            const tokenIds = Array.isArray(g.tokenIds)
              ? g.tokenIds.filter((id: any) => typeof id === "string")
              : [];
            if (tokenIds.length === 0) return null;
            return {
              id: typeof g.id === "string" ? g.id : newId(),
              role,
              tokenIds,
            };
          })
          .filter(Boolean) as Group[]
      : [];

    const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now();

    // グループ内 tokenIds を tokens順で正規化 & 存在しないIDを除去
    const tokenSet = new Set(tokens.map((t) => t.id));
    const normalizedGroups = groups
      .map((g) => ({
        ...g,
        tokenIds: sortTokenIdsByTokenOrder(
          g.tokenIds.filter((id) => tokenSet.has(id)),
          tokens
        ),
      }))
      .filter((g) => g.tokenIds.length > 0);

    return {
      version: 2,
      inputText,
      tokens,
      groups: normalizedGroups,
      updatedAt,
    };
  }

  // v1
  if (raw.version === 1) {
    const v1 = raw as StoreV1;
    const inputText = typeof v1.inputText === "string" ? v1.inputText : "";
    const tokens: Token[] = Array.isArray(v1.tokens)
      ? v1.tokens
          .map((x: any) => {
            if (!x || typeof x !== "object") return null;
            const text = typeof x.text === "string" ? x.text : null;
            if (!text) return null;
            const role = typeof x.role === "string" ? (x.role as Role) : "NONE";
            return { id: typeof x.id === "string" ? x.id : newId(), text, role };
          })
          .filter(Boolean) as Token[]
      : [];

    const groups: Group[] = [];
    for (const t of tokens) {
      const r = t.role ?? "NONE";
      if (r !== "NONE") {
        groups.push({ id: newId(), tokenIds: [t.id], role: r });
      }
      // v2以降は groupが主役なので、token.roleは保存しておくが表示は group優先
      // ここでは role情報の二重管理を避けるため、token.roleをNONEに寄せる
      t.role = "NONE";
    }

    const updatedAt = typeof v1.updatedAt === "number" ? v1.updatedAt : Date.now();

    return { version: 2, inputText, tokens, groups, updatedAt };
  }

  return base;
}

function loadLocal(): StoreV2 {
  if (typeof window === "undefined") return defaultStoreV2();
  const raw = safeParseJSON<any>(localStorage.getItem(LOCAL_KEY));
  return migrate(raw);
}

function saveLocal(s: StoreV2) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn("[close-reading] saveLocal failed:", e);
  }
}

export default function CloseReading() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef<Store>(store);

  // UI状態：複数選択
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const lastClickedIndexRef = useRef<number | null>(null);

  // tokenId -> group
  const groupByTokenId = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of store.groups) {
      for (const tid of g.tokenIds) m.set(tid, g);
    }
    return m;
  }, [store.groups]);

  const selectedTokens = useMemo(() => {
    const set = new Set(selectedIds);
    return store.tokens.filter((t) => set.has(t.id));
  }, [store.tokens, selectedIds]);

  const selectedText = useMemo(() => {
    if (selectedTokens.length === 0) return "";
    return selectedTokens.map((t) => t.text).join(" ");
  }, [selectedTokens]);

  // 選択が「単一グループのみ」か判定
  const selectedGroup = useMemo(() => {
    if (selectedIds.length === 0) return null;
    const gs = uniq(
      selectedIds
        .map((id) => groupByTokenId.get(id)?.id ?? "")
        .filter((x) => x)
    );
    if (gs.length !== 1) return null;
    return store.groups.find((g) => g.id === gs[0]) ?? null;
  }, [selectedIds, groupByTokenId, store.groups]);

  // ローカル即時保存
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // 手動同期購読（PULL / PUSH / LOCAL_DOC_APPLIED / storage）
  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<any>(DOC_KEY);
        const migrated = migrate(remote);
        if (migrated && migrated.version === 2) {
          setStore(migrated);
          saveLocal(migrated);
        }
      } catch (e) {
        console.warn("[close-reading] manual PULL failed:", e);
      }
    };

    const doPush = async () => {
      try {
        await saveUserDoc<Store>(DOC_KEY, storeRef.current);
      } catch (e) {
        console.warn("[close-reading] manual PUSH failed:", e);
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
            // noop（直後にPULL）
          } else if (t === LOCAL_APPLIED_TYPE && msg.docKey === DOC_KEY) {
            setStore(loadLocal()); // ホームがlocalStorageを書いた合図
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
        const parsed = safeParseJSON<any>(ev.newValue);
        if (parsed) setStore(migrate(parsed));
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

  // 入力文からトークン生成（既存タグはリセット）
  const onBuild = () => {
    const tokens = tokenize(store.inputText);
    setStore((prev) => ({
      ...prev,
      tokens,
      groups: [],
      updatedAt: Date.now(),
    }));
    setSelectedIds([]);
    lastClickedIndexRef.current = null;
  };

  // タグ全解除：グループを消す（下線表示は「全トークンが単体ユニット」になるので残る）
  const onClearTags = () => {
    setStore((prev) => ({
      ...prev,
      groups: [],
      updatedAt: Date.now(),
    }));
  };

  // 選択に role を付与：
  // - 選択が既存グループ1つに完全一致 → そのグループのrole更新
  // - それ以外 → 選択tokenを既存グループから外し、新しいグループを作成（1語でも作る）
  const setRoleToSelected = (role: Role) => {
    if (selectedIds.length === 0) return;

    const selectedSet = new Set(selectedIds);

    // 既存グループと完全一致しているなら roleだけ更新
    if (selectedGroup) {
      const gSet = new Set(selectedGroup.tokenIds);
      const same =
        selectedGroup.tokenIds.length === selectedIds.length &&
        selectedIds.every((id) => gSet.has(id));
      if (same) {
        setStore((prev) => ({
          ...prev,
          groups: prev.groups.map((g) => (g.id === selectedGroup.id ? { ...g, role } : g)),
          updatedAt: Date.now(),
        }));
        return;
      }
    }

    setStore((prev) => {
      // 1) 選択tokenを既存グループから除去（残りが0ならグループ削除）
      const nextGroups: Group[] = [];
      for (const g of prev.groups) {
        const rest = g.tokenIds.filter((tid) => !selectedSet.has(tid));
        if (rest.length > 0) nextGroups.push({ ...g, tokenIds: rest });
      }

      // 2) 新グループ作成（選択tokenを tokens順で並べる）
      const ordered = sortTokenIdsByTokenOrder(selectedIds, prev.tokens);
      nextGroups.push({
        id: newId(),
        tokenIds: ordered,
        role,
      });

      return { ...prev, groups: nextGroups, updatedAt: Date.now() };
    });
  };

  const autoHint = () => {
    // 超簡易：Vっぽい単語を「1語グループ(V)」として付与（既存のrole付与と共存）
    const vSet = new Set([
      "am",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "do",
      "does",
      "did",
      "have",
      "has",
      "had",
      "can",
      "could",
      "will",
      "would",
      "shall",
      "should",
      "may",
      "might",
      "must",
      "live",
      "exists",
      "exist",
      "make",
      "made",
      "give",
      "gave",
      "get",
      "got",
      "go",
      "went",
    ]);

    setStore((prev) => {
      const tokenIndex = new Map(prev.tokens.map((t, i) => [t.id, i]));
      const alreadyGrouped = new Set(prev.groups.flatMap((g) => g.tokenIds));

      const nextGroups = [...prev.groups];

      for (const t of prev.tokens) {
        if (!isWordToken(t.text)) continue;
        const key = t.text.toLowerCase();
        if (!vSet.has(key)) continue;
        if (alreadyGrouped.has(t.id)) continue;

        nextGroups.push({ id: newId(), tokenIds: [t.id], role: "V" });
      }

      // グループ正規化（順序）
      const normalized = nextGroups
        .map((g) => ({
          ...g,
          tokenIds: [...g.tokenIds].sort(
            (a, b) => (tokenIndex.get(a) ?? 1e9) - (tokenIndex.get(b) ?? 1e9)
          ),
        }))
        .sort((a, b) => {
          const amin = Math.min(...a.tokenIds.map((id) => tokenIndex.get(id) ?? 1e9));
          const bmin = Math.min(...b.tokenIds.map((id) => tokenIndex.get(id) ?? 1e9));
          return amin - bmin;
        });

      return { ...prev, groups: normalized, updatedAt: Date.now() };
    });
  };

  // クリック選択：Shift=範囲、Ctrl/Cmd=追加、通常=単一
  const onTokenClick = (index: number, id: string, ev: React.MouseEvent) => {
    const isShift = ev.shiftKey;
    const isMeta = ev.metaKey || ev.ctrlKey;

    if (isShift && lastClickedIndexRef.current !== null) {
      const a = lastClickedIndexRef.current;
      const b = index;
      const [from, to] = a < b ? [a, b] : [b, a];
      const rangeIds = store.tokens.slice(from, to + 1).map((t) => t.id);
      setSelectedIds((prev) => uniq([...prev, ...rangeIds]));
      return;
    }

    if (isMeta) {
      setSelectedIds((prev) => {
        const set = new Set(prev);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        return Array.from(set);
      });
      lastClickedIndexRef.current = index;
      return;
    }

    setSelectedIds([id]);
    lastClickedIndexRef.current = index;
  };

  const clearSelection = () => {
    setSelectedIds([]);
    lastClickedIndexRef.current = null;
  };

  const roleHintText =
    selectedTokens.length >= 2
      ? `（${selectedTokens.length}語に一括適用）`
      : selectedTokens.length === 1
      ? "（1語）"
      : "";

  // 表示ユニット作成：
  // - グループがあれば、その最初tokenでユニット開始（role表示は1回）
  // - グループに属さないtokenは単体ユニット（role表示なし）
  // - 下線は「すべてのユニット」に付与（1語でも付く）
  const displayUnits = useMemo(() => {
    const tokenIndex = new Map(store.tokens.map((t, i) => [t.id, i]));

    // groupId -> group（開始位置順で）
    const groupsSorted = [...store.groups]
      .map((g) => ({
        ...g,
        tokenIds: sortTokenIdsByTokenOrder(g.tokenIds, store.tokens),
      }))
      .sort((a, b) => {
        const amin = Math.min(...a.tokenIds.map((id) => tokenIndex.get(id) ?? 1e9));
        const bmin = Math.min(...b.tokenIds.map((id) => tokenIndex.get(id) ?? 1e9));
        return amin - bmin;
      });

    const groupByToken = new Map<string, Group>();
    for (const g of groupsSorted) for (const id of g.tokenIds) groupByToken.set(id, g);

    const started = new Set<string>();
    const units: { tokenIds: string[]; roleToShow: Role }[] = [];

    for (const t of store.tokens) {
      const g = groupByToken.get(t.id);
      if (!g) {
        units.push({ tokenIds: [t.id], roleToShow: "NONE" }); // 単体ユニット（下線あり、role表示なし）
        continue;
      }
      if (started.has(g.id)) continue;

      started.add(g.id);
      units.push({ tokenIds: g.tokenIds, roleToShow: g.role }); // グループユニット（role表示1回）
    }

    return units;
  }, [store.tokens, store.groups]);

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">精読（SVOCMタグ付け）</h1>
        <div className="text-xs text-gray-500">
          localStorage即時保存 / サーバ同期はホームの📥/☁のみ
        </div>
      </div>

      {/* 入力 */}
      <div className="rounded-2xl border bg-white p-4 space-y-3 shadow-sm">
        <div className="text-sm font-medium">英文を入力</div>
        <textarea
          className="w-full min-h-[110px] rounded-xl border p-3 text-sm outline-none focus:ring-2 focus:ring-gray-200"
          placeholder="例: Some fish live in fresh water, and others live in salt water."
          value={store.inputText}
          onChange={(e) =>
            setStore((prev) => ({
              ...prev,
              inputText: e.target.value,
              updatedAt: Date.now(),
            }))
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={onBuild}
          >
            単語に分解（タグ付け開始）
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={onClearTags}
            disabled={store.tokens.length === 0}
          >
            タグを全解除
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={autoHint}
            disabled={store.tokens.length === 0}
            title="超簡易のV候補だけ自動で付与（精度は高くない）"
          >
            自動ヒント（V候補）
          </button>

          <div className="ml-auto text-xs text-gray-500">
            更新: {new Date(store.updatedAt).toLocaleString()}
          </div>
        </div>

        <div className="text-xs text-gray-500">
          選択操作：クリック=1語 / Shift+クリック=範囲（2語OK） / Ctrl(or Cmd)+クリック=追加
        </div>
      </div>

      {/* トークン表示：下線＋roleはグループで1回だけ */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">
            単語（上）／役割（下） ※roleは「まとまり」で1つだけ表示、下線でまとまり可視化
          </div>
          <button
            className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
            onClick={clearSelection}
            disabled={selectedIds.length === 0}
            title="選択解除"
          >
            選択解除
          </button>
        </div>

        {store.tokens.length === 0 ? (
          <div className="text-sm text-gray-500">
            まだ分解されていません。「単語に分解（タグ付け開始）」を押してください。
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 items-end">
            {displayUnits.map((u, ui) => {
              const roleText = roleShort(u.roleToShow);

              return (
                <div key={`${ui}-${u.tokenIds.join(",")}`} className="flex flex-col items-center">
                  {/* 下線：1語でも必ず表示。グループ単位で1本になる */}
                  <div className="inline-flex items-end border-b border-gray-700 pb-1">
                    {u.tokenIds.map((tid) => {
                      const token = store.tokens.find((t) => t.id === tid);
                      if (!token) return null;
                      const idx = store.tokens.findIndex((t) => t.id === tid);
                      const selected = selectedIds.includes(tid);

                      // グループ色は roleToShow 基準（未設定は白）
                      const roleClass = classForRole(u.roleToShow === "NONE" ? "NONE" : u.roleToShow);

                      return (
                        <button
                          key={tid}
                          onClick={(ev) => onTokenClick(idx, tid, ev)}
                          className={[
                            "rounded-xl border px-2 py-1 mx-[2px] transition",
                            roleClass,
                            selected ? "ring-2 ring-black/15" : "hover:bg-gray-50",
                            !isWordToken(token.text) ? "opacity-80" : "",
                          ].join(" ")}
                          title="クリックで選択（Shiftで範囲）"
                        >
                          <div className="text-sm leading-none">{token.text}</div>
                        </button>
                      );
                    })}
                  </div>

                  {/* role表示：グループで1回だけ。単体未設定ユニットは空 */}
                  <div className="mt-1 text-[10px] text-gray-600 min-h-[12px]">
                    {roleText}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 役割パネル：選択中の語（複数OK）に一括適用 */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
        <div className="text-sm font-medium">
          選択中の単語に役割を設定 {roleHintText}
        </div>

        {selectedTokens.length === 0 ? (
          <div className="text-sm text-gray-500">
            上の単語をクリックしてください（2語なら Shift+クリック）。
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm">
                選択: <span className="font-semibold">{selectedText}</span>
              </div>
              <div className="text-xs text-gray-500">
                {selectedGroup
                  ? `現在（同一まとまり）: ${selectedGroup.role}`
                  : "現在:（複数まとまり/未まとまり混在。役割を押すと選択範囲で新しいまとまりを作成）"}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {ROLE_LABELS.map(({ role, label }) => (
                <button
                  key={role}
                  onClick={() => setRoleToSelected(role)}
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="text-xs text-gray-500">
              ※「that place」を2語選択して S にすると、下線が2語をまとめて1本になり、roleは1回だけ表示されます。
            </div>
          </div>
        )}

        <div className="pt-2 border-t text-xs text-gray-600 space-y-1">
          <div>コツ：</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>まず動詞（V）を見つける → その前の名詞（代名詞）が主語（S）になりやすい</li>
            <li>他動詞なら O（目的語）が来ることが多い / 自動詞なら M（修飾）で終わりやすい</li>
            <li>and / but で並ぶときは、後半も同じ構造が繰り返されることが多い</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
