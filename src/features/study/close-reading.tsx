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

// 単語の上に出す「詳細タグ（品詞など）」
type Detail =
  | "名"
  | "動"
  | "形"
  | "副"
  | "前"
  | "冠"
  | "代"
  | "助"
  | "接"
  | "等"
  | "他"
  | "NONE";

// ★追加：句/従属節の括弧（表示だけで、tokens順は絶対に動かさない）
type SpanKind = "PHRASE" | "CLAUSE"; // PHRASE=( ) / CLAUSE=[ ]

type Token = {
  id: string;
  text: string;
  role?: Role; // v1互換のため残す（v2以降は group が主役）
  detail?: Detail; // 単語の上に出す詳細タグ
};

type Group = {
  id: string;
  tokenIds: string[]; // tokens順に正規化して保存
  role: Role; // 下線の下に出す SVOCM 等（グループで1つだけ表示）
};

type Span = {
  id: string;
  kind: SpanKind;
  tokenIds: string[]; // 連続範囲（tokens順に正規化して保存）
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
  groups: Group[];
  updatedAt: number;
};

type StoreV3 = {
  version: 3;
  inputText: string;
  tokens: Token[];
  groups: Group[];
  updatedAt: number;
};

type StoreV4 = {
  version: 4;
  inputText: string;
  tokens: Token[];
  groups: Group[];
  spans: Span[]; // ★追加
  updatedAt: number;
};

type Store = StoreV4;

const LOCAL_KEY = "study_close_reading_v1";
const DOC_KEY = "study_close_reading_v1";

const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

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

const DETAIL_LABELS: { detail: Detail; label: string }[] = [
  { detail: "形", label: "形（形容詞）" },
  { detail: "副", label: "副（副詞）" },
  { detail: "名", label: "名（名詞）" },
  { detail: "代", label: "代（代名詞）" },
  { detail: "動", label: "動（動詞）" },
  { detail: "前", label: "前（前置詞）" },
  { detail: "冠", label: "冠（冠詞）" },
  { detail: "助", label: "助（助動詞）" },
  { detail: "接", label: "接（接続詞）" },
  { detail: "等", label: "等（等位・並列）" },
  { detail: "他", label: "他（その他）" },
  { detail: "NONE", label: "未設定" },
];

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** 英文を「単語/記号」単位に分割（空白は捨てる） */
function tokenize(text: string): Token[] {
  const re = /[A-Za-z]+(?:'[A-Za-z]+)?|\d+(?:\.\d+)?|[^\sA-Za-z0-9]/g;
  const raw = text.match(re) ?? [];
  return raw.map((t) => ({
    id: newId(),
    text: t,
    role: "NONE",
    detail: "NONE",
  }));
}

function defaultStoreV4(): StoreV4 {
  return {
    version: 4,
    inputText: "",
    tokens: [],
    groups: [],
    spans: [],
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
  return role === "NONE" ? "" : role;
}

function detailShort(detail: Detail) {
  return detail === "NONE" ? "" : `(${detail})`;
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

/** tokens順に tokenIds を正規化 */
function normalizeTokenIds(tokenIds: string[], idToIndex: Map<string, number>) {
  const dedup = Array.from(new Set(tokenIds));
  dedup.sort((a, b) => (idToIndex.get(a) ?? 1e9) - (idToIndex.get(b) ?? 1e9));
  return dedup;
}

/** 選択が飛び飛びなら、最小～最大の“連続範囲”に寄せる */
function coerceToContiguousSelection(
  selectedIds: string[],
  idToIndex: Map<string, number>,
  tokens: Token[]
) {
  if (selectedIds.length <= 1) return selectedIds;

  const idxs = selectedIds
    .map((id) => idToIndex.get(id))
    .filter((x): x is number => typeof x === "number");

  if (idxs.length <= 1) return selectedIds;

  const min = Math.min(...idxs);
  const max = Math.max(...idxs);
  return tokens.slice(min, max + 1).map((t) => t.id);
}

function spanMarkers(kind: SpanKind) {
  return kind === "CLAUSE" ? { open: "[", close: "]" } : { open: "(", close: ")" };
}

function spanRange(span: Span, idToIndex: Map<string, number>) {
  const idxs = span.tokenIds
    .map((id) => idToIndex.get(id))
    .filter((x): x is number => typeof x === "number");
  if (idxs.length === 0) return { start: 1e9, end: -1 };
  return { start: Math.min(...idxs), end: Math.max(...idxs) };
}

function isContained(a: { start: number; end: number }, b: { start: number; end: number }) {
  // a が b に含まれる
  return b.start <= a.start && a.end <= b.end;
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return !(a.end < b.start || b.end < a.start);
}

function crosses(a: { start: number; end: number }, b: { start: number; end: number }) {
  // 交差（部分的に被るが、包含関係ではない）
  if (!overlaps(a, b)) return false;
  if (isContained(a, b) || isContained(b, a)) return false;
  return true;
}

/** v1/v2/v3/v4 を v4 に吸収 */
function migrate(raw: any): StoreV4 {
  const base = defaultStoreV4();
  if (!raw || typeof raw !== "object") return base;

  // v4
  if (raw.version === 4) {
    const inputText = typeof raw.inputText === "string" ? raw.inputText : "";

    const tokens: Token[] = Array.isArray(raw.tokens)
      ? raw.tokens
          .map((x: any) => {
            if (!x || typeof x !== "object") return null;
            const text = typeof x.text === "string" ? x.text : null;
            if (!text) return null;
            const role = typeof x.role === "string" ? (x.role as Role) : "NONE";
            const detail = typeof x.detail === "string" ? (x.detail as Detail) : "NONE";
            return {
              id: typeof x.id === "string" ? x.id : newId(),
              text,
              role,
              detail,
            };
          })
          .filter(Boolean) as Token[]
      : [];

    const idToIndex = new Map(tokens.map((t, i) => [t.id, i]));
    const tokenSet = new Set(tokens.map((t) => t.id));

    const groups: Group[] = Array.isArray(raw.groups)
      ? raw.groups
          .map((g: any) => {
            if (!g || typeof g !== "object") return null;
            const role = typeof g.role === "string" ? (g.role as Role) : "NONE";
            const tokenIdsRaw = Array.isArray(g.tokenIds)
              ? g.tokenIds.filter((id: any) => typeof id === "string" && tokenSet.has(id))
              : [];
            if (tokenIdsRaw.length === 0) return null;
            return {
              id: typeof g.id === "string" ? g.id : newId(),
              role,
              tokenIds: normalizeTokenIds(tokenIdsRaw, idToIndex),
            };
          })
          .filter(Boolean) as Group[]
      : [];

    const spans: Span[] = Array.isArray(raw.spans)
      ? raw.spans
          .map((s: any) => {
            if (!s || typeof s !== "object") return null;
            const kind = s.kind === "CLAUSE" || s.kind === "PHRASE" ? (s.kind as SpanKind) : null;
            if (!kind) return null;
            const tokenIdsRaw = Array.isArray(s.tokenIds)
              ? s.tokenIds.filter((id: any) => typeof id === "string" && tokenSet.has(id))
              : [];
            if (tokenIdsRaw.length === 0) return null;
            return {
              id: typeof s.id === "string" ? s.id : newId(),
              kind,
              tokenIds: normalizeTokenIds(tokenIdsRaw, idToIndex),
            };
          })
          .filter(Boolean) as Span[]
      : [];

    const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now();
    return { version: 4, inputText, tokens, groups, spans, updatedAt };
  }

  // v3
  if (raw.version === 3) {
    const v3 = raw as StoreV3;
    const inputText = typeof v3.inputText === "string" ? v3.inputText : "";
    const tokens: Token[] = Array.isArray(v3.tokens)
      ? v3.tokens
          .map((x: any) => {
            if (!x || typeof x !== "object") return null;
            const text = typeof x.text === "string" ? x.text : null;
            if (!text) return null;
            const role = typeof x.role === "string" ? (x.role as Role) : "NONE";
            const detail = typeof x.detail === "string" ? (x.detail as Detail) : "NONE";
            return { id: typeof x.id === "string" ? x.id : newId(), text, role, detail };
          })
          .filter(Boolean) as Token[]
      : [];
    const idToIndex = new Map(tokens.map((t, i) => [t.id, i]));
    const tokenSet = new Set(tokens.map((t) => t.id));

    const groups: Group[] = Array.isArray((v3 as any).groups)
      ? (v3 as any).groups
          .map((g: any) => {
            if (!g || typeof g !== "object") return null;
            const role = typeof g.role === "string" ? (g.role as Role) : "NONE";
            const tokenIdsRaw = Array.isArray(g.tokenIds)
              ? g.tokenIds.filter((id: any) => typeof id === "string" && tokenSet.has(id))
              : [];
            if (tokenIdsRaw.length === 0) return null;
            return {
              id: typeof g.id === "string" ? g.id : newId(),
              role,
              tokenIds: normalizeTokenIds(tokenIdsRaw, idToIndex),
            };
          })
          .filter(Boolean) as Group[]
      : [];

    const updatedAt = typeof (v3 as any).updatedAt === "number" ? (v3 as any).updatedAt : Date.now();
    return { version: 4, inputText, tokens, groups, spans: [], updatedAt };
  }

  // v2
  if (raw.version === 2) {
    const v2 = raw as StoreV2;
    const inputText = typeof v2.inputText === "string" ? v2.inputText : "";

    const tokens: Token[] = Array.isArray(v2.tokens)
      ? v2.tokens
          .map((x: any) => {
            if (!x || typeof x !== "object") return null;
            const text = typeof x.text === "string" ? x.text : null;
            if (!text) return null;
            return {
              id: typeof x.id === "string" ? x.id : newId(),
              text,
              role: typeof x.role === "string" ? (x.role as Role) : "NONE",
              detail: "NONE",
            };
          })
          .filter(Boolean) as Token[]
      : [];

    const idToIndex = new Map(tokens.map((t, i) => [t.id, i]));
    const tokenSet = new Set(tokens.map((t) => t.id));

    const groups: Group[] = Array.isArray(v2.groups)
      ? v2.groups
          .map((g: any) => {
            if (!g || typeof g !== "object") return null;
            const role = typeof g.role === "string" ? (g.role as Role) : "NONE";
            const tokenIdsRaw = Array.isArray(g.tokenIds)
              ? g.tokenIds.filter((id: any) => typeof id === "string" && tokenSet.has(id))
              : [];
            if (tokenIdsRaw.length === 0) return null;
            return {
              id: typeof g.id === "string" ? g.id : newId(),
              role,
              tokenIds: normalizeTokenIds(tokenIdsRaw, idToIndex),
            };
          })
          .filter(Boolean) as Group[]
      : [];

    const updatedAt = typeof v2.updatedAt === "number" ? v2.updatedAt : Date.now();
    return { version: 4, inputText, tokens, groups, spans: [], updatedAt };
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
            return { id: typeof x.id === "string" ? x.id : newId(), text, role, detail: "NONE" };
          })
          .filter(Boolean) as Token[]
      : [];

    const idToIndex = new Map(tokens.map((t, i) => [t.id, i]));
    const groups: Group[] = [];

    for (const t of tokens) {
      const r = t.role ?? "NONE";
      if (r !== "NONE") groups.push({ id: newId(), tokenIds: [t.id], role: r });
      t.role = "NONE";
    }

    const normalized = groups.map((g) => ({ ...g, tokenIds: normalizeTokenIds(g.tokenIds, idToIndex) }));
    const updatedAt = typeof v1.updatedAt === "number" ? v1.updatedAt : Date.now();

    return { version: 4, inputText, tokens, groups: normalized, spans: [], updatedAt };
  }

  return base;
}

function loadLocal(): StoreV4 {
  if (typeof window === "undefined") return defaultStoreV4();
  const raw = safeParseJSON<any>(localStorage.getItem(LOCAL_KEY));
  return migrate(raw);
}

function saveLocal(s: StoreV4) {
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

  // 選択（ID）
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Shift用アンカー
  const anchorIndexRef = useRef<number | null>(null);

  // tokens順の index map（順番固定の要）
  const idToIndex = useMemo(() => new Map(store.tokens.map((t, i) => [t.id, i])), [store.tokens]);

  // tokenId -> group
  const groupByTokenId = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of store.groups) for (const tid of g.tokenIds) m.set(tid, g);
    return m;
  }, [store.groups]);

  const selectedTokens = useMemo(() => {
    const set = new Set(selectedIds);
    return store.tokens.filter((t) => set.has(t.id));
  }, [store.tokens, selectedIds]);

  const selectedText = useMemo(() => selectedTokens.map((t) => t.text).join(" "), [selectedTokens]);

  const selectedGroup = useMemo(() => {
    if (selectedIds.length === 0) return null;
    const groupIds = uniq(
      selectedIds.map((id) => groupByTokenId.get(id)?.id ?? "").filter((x) => x)
    );
    if (groupIds.length !== 1) return null;
    return store.groups.find((g) => g.id === groupIds[0]) ?? null;
  }, [selectedIds, groupByTokenId, store.groups]);

  const selectedDetailState = useMemo(() => {
    if (selectedTokens.length === 0) return "";
    const details = uniq(selectedTokens.map((t) => (t.detail ?? "NONE") as string));
    if (details.length === 1) return details[0] === "NONE" ? "NONE" : details[0];
    return "MIXED";
  }, [selectedTokens]);

  // ローカル即時保存
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
        const migrated = migrate(remote);
        if (migrated && migrated.version === 4) {
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

  // 入力文からトークン生成
  const onBuild = () => {
    const tokens = tokenize(store.inputText);
    setStore((prev) => ({
      ...prev,
      version: 4,
      tokens,
      groups: [],
      spans: [],
      updatedAt: Date.now(),
    }));
    setSelectedIds([]);
    anchorIndexRef.current = null;
  };

  const onClearSVOCM = () => {
    setStore((prev) => ({
      ...prev,
      groups: [],
      updatedAt: Date.now(),
    }));
  };

  const onClearBrackets = () => {
    setStore((prev) => ({
      ...prev,
      spans: [],
      updatedAt: Date.now(),
    }));
  };

  // クリック選択（順番は絶対に動かさない。Shiftは範囲で置き換え）
  const onTokenClick = (index: number, id: string, ev: React.MouseEvent) => {
    const isShift = ev.shiftKey;
    const isMeta = ev.metaKey || ev.ctrlKey;

    if (isShift) {
      const anchor = anchorIndexRef.current ?? index;
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
      const rangeIds = store.tokens.slice(from, to + 1).map((t) => t.id);
      setSelectedIds(rangeIds);
      return;
    }

    if (isMeta) {
      setSelectedIds((prev) => {
        const s = new Set(prev);
        if (s.has(id)) s.delete(id);
        else s.add(id);
        return Array.from(s);
      });
      anchorIndexRef.current = index;
      return;
    }

    setSelectedIds([id]);
    anchorIndexRef.current = index;
  };

  const clearSelection = () => {
    setSelectedIds([]);
    anchorIndexRef.current = null;
  };

  // role付与（飛び飛びは連続範囲に補正）
  const setRoleToSelected = (role: Role) => {
    if (selectedIds.length === 0) return;

    const coerced = coerceToContiguousSelection(selectedIds, idToIndex, store.tokens);
    const selectedSet = new Set(coerced);

    // 既存グループと完全一致なら role だけ更新
    if (selectedGroup) {
      const gSet = new Set(selectedGroup.tokenIds);
      const same = selectedGroup.tokenIds.length === coerced.length && coerced.every((x) => gSet.has(x));
      if (same) {
        setStore((prev) => ({
          ...prev,
          groups: prev.groups.map((g) => (g.id === selectedGroup.id ? { ...g, role } : g)),
          updatedAt: Date.now(),
        }));
        setSelectedIds(coerced);
        return;
      }
    }

    setStore((prev) => {
      const idToIndex2 = new Map(prev.tokens.map((t, i) => [t.id, i]));

      // 1) 選択tokenを既存グループから除去（空なら削除）
      const nextGroups: Group[] = [];
      for (const g of prev.groups) {
        const rest = g.tokenIds.filter((tid) => !selectedSet.has(tid));
        if (rest.length > 0) nextGroups.push({ ...g, tokenIds: normalizeTokenIds(rest, idToIndex2) });
      }

      // 2) 新グループ作成
      nextGroups.push({
        id: newId(),
        tokenIds: normalizeTokenIds(coerced, idToIndex2),
        role,
      });

      // 3) 表示順安定化（tokens順）
      nextGroups.sort((a, b) => {
        const amin = Math.min(...a.tokenIds.map((id) => idToIndex2.get(id) ?? 1e9));
        const bmin = Math.min(...b.tokenIds.map((id) => idToIndex2.get(id) ?? 1e9));
        return amin - bmin;
      });

      return { ...prev, groups: nextGroups, updatedAt: Date.now() };
    });

    setSelectedIds(coerced);
  };

  // 詳細タグ（上）付与
  const setDetailToSelected = (detail: Detail) => {
    if (selectedIds.length === 0) return;

    const coerced = coerceToContiguousSelection(selectedIds, idToIndex, store.tokens);
    const set = new Set(coerced);

    setStore((prev) => ({
      ...prev,
      tokens: prev.tokens.map((t) => (set.has(t.id) ? { ...t, detail } : t)),
      updatedAt: Date.now(),
    }));

    setSelectedIds(coerced);
  };

  // ★括弧（句/従属節）付与：交差する括弧は自動で解消（順番は変えない）
  const setSpanToSelected = (kind: SpanKind) => {
    if (selectedIds.length === 0) return;

    const coerced = coerceToContiguousSelection(selectedIds, idToIndex, store.tokens);

    setStore((prev) => {
      const idToIndex2 = new Map(prev.tokens.map((t, i) => [t.id, i]));
      const tokenSet = new Set(prev.tokens.map((t) => t.id));
      const nextTokenIds = coerced.filter((id) => tokenSet.has(id));
      if (nextTokenIds.length === 0) return prev;

      const normalizedNew = normalizeTokenIds(nextTokenIds, idToIndex2);
      const newSpan: Span = { id: newId(), kind, tokenIds: normalizedNew };
      const newR = spanRange(newSpan, idToIndex2);

      const kept: Span[] = [];
      for (const s of prev.spans ?? []) {
        const s2: Span = {
          id: typeof s.id === "string" ? s.id : newId(),
          kind: s.kind === "CLAUSE" || s.kind === "PHRASE" ? s.kind : "PHRASE",
          tokenIds: normalizeTokenIds(
            (Array.isArray(s.tokenIds) ? s.tokenIds : []).filter((id) => tokenSet.has(id)),
            idToIndex2
          ),
        };
        if (s2.tokenIds.length === 0) continue;

        const r = spanRange(s2, idToIndex2);

        // 1) 完全一致（同じ範囲＆同じkind）なら “更新” とみなして置き換え
        if (s2.kind === kind && r.start === newR.start && r.end === newR.end) {
          // drop（後で newSpan を入れる）
          continue;
        }

        // 2) 交差（クロス）するものは削除（ネストは許可）
        if (crosses(r, newR)) continue;

        kept.push(s2);
      }

      // 追加
      kept.push(newSpan);

      // 表示の安定化：開始位置→長い順（外側を先に）、同位置なら CLAUSE優先
      kept.sort((a, b) => {
        const ra = spanRange(a, idToIndex2);
        const rb = spanRange(b, idToIndex2);
        if (ra.start !== rb.start) return ra.start - rb.start;
        const la = ra.end - ra.start;
        const lb = rb.end - rb.start;
        if (la !== lb) return lb - la; // 長い順（外側）
        if (a.kind !== b.kind) return a.kind === "CLAUSE" ? -1 : 1;
        return a.id.localeCompare(b.id);
      });

      return { ...prev, spans: kept, updatedAt: Date.now() };
    });

    setSelectedIds(coerced);
  };

  // ★括弧を外す：選択範囲に少しでも被る span を削除
  const removeSpansOverlappingSelection = () => {
    if (selectedIds.length === 0) return;
    const coerced = coerceToContiguousSelection(selectedIds, idToIndex, store.tokens);

    setStore((prev) => {
      const idToIndex2 = new Map(prev.tokens.map((t, i) => [t.id, i]));
      const selR = (() => {
        const idxs = coerced
          .map((id) => idToIndex2.get(id))
          .filter((x): x is number => typeof x === "number");
        if (idxs.length === 0) return { start: 1e9, end: -1 };
        return { start: Math.min(...idxs), end: Math.max(...idxs) };
      })();

      const next = (prev.spans ?? []).filter((s) => {
        const r = spanRange(s, idToIndex2);
        return !overlaps(r, selR);
      });

      return { ...prev, spans: next, updatedAt: Date.now() };
    });

    setSelectedIds(coerced);
  };

  const autoHint = () => {
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
      const idToIndex2 = new Map(prev.tokens.map((t, i) => [t.id, i]));
      const tokenSetInGroups = new Set(prev.groups.flatMap((g) => g.tokenIds));
      const nextGroups = [...prev.groups];

      const nextTokens = prev.tokens.map((t) => {
        if (!isWordToken(t.text)) return t;
        const key = t.text.toLowerCase();
        if (!vSet.has(key)) return t;
        const nextDetail = (t.detail ?? "NONE") === "NONE" ? "動" : t.detail;
        return { ...t, detail: nextDetail };
      });

      for (const t of nextTokens) {
        if (!isWordToken(t.text)) continue;
        const key = t.text.toLowerCase();
        if (!vSet.has(key)) continue;
        if (tokenSetInGroups.has(t.id)) continue;
        nextGroups.push({ id: newId(), tokenIds: [t.id], role: "V" });
      }

      for (const g of nextGroups) g.tokenIds = normalizeTokenIds(g.tokenIds, idToIndex2);
      nextGroups.sort((a, b) => {
        const amin = Math.min(...a.tokenIds.map((id) => idToIndex2.get(id) ?? 1e9));
        const bmin = Math.min(...b.tokenIds.map((id) => idToIndex2.get(id) ?? 1e9));
        return amin - bmin;
      });

      return { ...prev, tokens: nextTokens, groups: nextGroups, updatedAt: Date.now() };
    });
  };

  const roleHintText =
    selectedTokens.length >= 2 ? `（${selectedTokens.length}語）` : selectedTokens.length === 1 ? "（1語）" : "";

  // 表示ユニット（tokensを左→右に走査して生成：順番が絶対に入れ替わらない）
  const displayUnits = useMemo(() => {
    const tokenToGroup = new Map<string, Group>();
    for (const g of store.groups) for (const tid of g.tokenIds) tokenToGroup.set(tid, g);

    const started = new Set<string>();
    const units: { tokenIds: string[]; roleToShow: Role }[] = [];

    for (const t of store.tokens) {
      const g = tokenToGroup.get(t.id);
      if (!g) {
        units.push({ tokenIds: [t.id], roleToShow: "NONE" });
        continue;
      }
      if (started.has(g.id)) continue;
      started.add(g.id);

      const ordered = normalizeTokenIds(g.tokenIds, idToIndex);
      units.push({ tokenIds: ordered, roleToShow: g.role });
    }

    return units;
  }, [store.tokens, store.groups, idToIndex]);

  // ★括弧の開始/終了マーカー（ネスト対応：外側→内側の順）
  const spanMarksByTokenId = useMemo(() => {
    const starts = new Map<string, string[]>();
    const ends = new Map<string, string[]>();

    const spans = store.spans ?? [];
    const enriched = spans
      .map((s) => {
        const r = spanRange(s, idToIndex);
        return { s, r, len: r.end - r.start };
      })
      .filter((x) => x.r.end >= x.r.start);

    // start: 長い順（外側を先に開く）
    enriched
      .slice()
      .sort((a, b) => (a.r.start !== b.r.start ? a.r.start - b.r.start : b.len - a.len))
      .forEach(({ s }) => {
        const open = spanMarkers(s.kind).open;
        const first = s.tokenIds[0];
        if (!first) return;
        const arr = starts.get(first) ?? [];
        arr.push(open);
        starts.set(first, arr);
      });

    // end: 短い順（内側から閉じる）
    enriched
      .slice()
      .sort((a, b) => (a.r.end !== b.r.end ? a.r.end - b.r.end : a.len - b.len))
      .forEach(({ s }) => {
        const close = spanMarkers(s.kind).close;
        const last = s.tokenIds[s.tokenIds.length - 1];
        if (!last) return;
        const arr = ends.get(last) ?? [];
        arr.push(close);
        ends.set(last, arr);
      });

    return { starts, ends };
  }, [store.spans, idToIndex]);

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">精読（上：詳細 / 下：SVOCM / 括弧：[ ] ( )）</h1>
        <div className="text-xs text-gray-500">localStorage即時保存 / サーバ同期はホームの📥/☁のみ</div>
      </div>

      {/* 入力 */}
      <div className="rounded-2xl border bg-white p-4 space-y-3 shadow-sm">
        <div className="text-sm font-medium">英文を入力</div>
        <textarea
          className="w-full min-h-[110px] rounded-xl border p-3 text-sm outline-none focus:ring-2 focus:ring-gray-200"
          placeholder="例: Every living thing exists (in a particular place), and that place has certain conditions."
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
          <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" onClick={onBuild}>
            単語に分解（タグ付け開始）
          </button>

          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={onClearSVOCM}
            disabled={store.tokens.length === 0}
          >
            下（SVOCM）を全解除
          </button>

          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={onClearBrackets}
            disabled={store.tokens.length === 0}
          >
            括弧（[ ] / ( )）を全解除
          </button>

          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={autoHint}
            disabled={store.tokens.length === 0}
            title="超簡易のV候補だけ自動で付与（精度は高くない）"
          >
            自動ヒント（V候補）
          </button>

          <div className="ml-auto text-xs text-gray-500">更新: {new Date(store.updatedAt).toLocaleString()}</div>
        </div>

        <div className="text-xs text-gray-500">
          選択：クリック=1語 / Shift+クリック=範囲（置き換えで安定） / Ctrl(or Cmd)+クリック=追加/解除
        </div>
      </div>

      {/* 表示 */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">上：詳細 / 中：単語（下線） / 下：SVOCM / 括弧：[ ] と ( )</div>
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
              const roleClass = classForRole(u.roleToShow === "NONE" ? "NONE" : u.roleToShow);

              return (
                <div key={`${ui}-${u.tokenIds.join(",")}`} className="flex flex-col items-center">
                  <div className="inline-flex items-end border-b border-gray-700 pb-1">
                    {u.tokenIds.map((tid) => {
                      const idx = idToIndex.get(tid);
                      const token = idx !== undefined ? store.tokens[idx] : null;
                      if (!token || idx === undefined) return null;

                      const selected = selectedIds.includes(tid);
                      const top = detailShort((token.detail ?? "NONE") as Detail);

                      const opens = spanMarksByTokenId.starts.get(tid) ?? [];
                      const closes = spanMarksByTokenId.ends.get(tid) ?? [];

                      return (
                        <div key={tid} className="flex flex-col items-center mx-[2px]">
                          {/* 上：詳細タグ */}
                          <div className="text-[10px] text-gray-700 min-h-[12px] leading-none">{top}</div>

                          {/* 中：括弧 + 単語 + 括弧（同じ行で表示） */}
                          <div className="flex items-center gap-[2px]">
                            {opens.map((m, i) => (
                              <div key={`o-${tid}-${i}`} className="text-xs text-gray-700 select-none">
                                {m}
                              </div>
                            ))}

                            <button
                              onClick={(ev) => onTokenClick(idx, tid, ev)}
                              className={[
                                "rounded-xl border px-2 py-1 transition",
                                roleClass,
                                selected ? "ring-2 ring-black/15" : "hover:bg-gray-50",
                                !isWordToken(token.text) ? "opacity-80" : "",
                              ].join(" ")}
                              title="クリックで選択（Shiftで範囲）"
                            >
                              <div className="text-sm leading-none">{token.text}</div>
                            </button>

                            {closes.map((m, i) => (
                              <div key={`c-${tid}-${i}`} className="text-xs text-gray-700 select-none">
                                {m}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 下：SVOCM */}
                  <div className="mt-1 text-[10px] text-gray-600 min-h-[12px]">{roleText}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 括弧パネル */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
        <div className="text-sm font-medium">括弧を付ける（従属節は[ ]、句は( )） {roleHintText}</div>

        {selectedTokens.length === 0 ? (
          <div className="text-sm text-gray-500">上の単語をクリックして範囲選択してください。</div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm">
                選択: <span className="font-semibold">{selectedText}</span>
              </div>
              <div className="text-xs text-gray-500">
                ※括弧は「交差（クロス）」する形だけ自動で解消します（ネストはOK）。
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSpanToSelected("CLAUSE")}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                title="従属節：[ ]"
              >
                従属節を [ ] で囲む
              </button>
              <button
                onClick={() => setSpanToSelected("PHRASE")}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                title="句：( )"
              >
                句を ( ) で囲む
              </button>
              <button
                onClick={removeSpansOverlappingSelection}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                title="選択範囲に被る括弧を外す"
              >
                選択範囲の括弧を外す
              </button>
            </div>

            <div className="text-xs text-gray-500">
              ※飛び飛び選択は、最小〜最大の連続範囲に自動補正して括弧を付けます。
            </div>
          </div>
        )}
      </div>

      {/* 上の詳細タグ パネル */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
        <div className="text-sm font-medium">上の詳細タグ（品詞など）を設定 {roleHintText}</div>

        {selectedTokens.length === 0 ? (
          <div className="text-sm text-gray-500">上の単語をクリックして選択してください。</div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm">
                選択: <span className="font-semibold">{selectedText}</span>
              </div>
              <div className="text-xs text-gray-500">
                {selectedDetailState === "MIXED"
                  ? "現在（詳細タグ）: 混在"
                  : selectedDetailState === "NONE"
                  ? "現在（詳細タグ）: 未設定"
                  : `現在（詳細タグ）: ${selectedDetailState}`}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {DETAIL_LABELS.map(({ detail, label }) => (
                <button
                  key={detail}
                  onClick={() => setDetailToSelected(detail)}
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="text-xs text-gray-500">
              ※複数選択中なら、選択範囲の単語すべてに同じ詳細タグを付けます（飛び飛び選択は連続範囲に補正）。
            </div>
          </div>
        )}
      </div>

      {/* 下（SVOCM）パネル */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
        <div className="text-sm font-medium">下線の下（SVOCMなど）を設定 {roleHintText}</div>

        {selectedTokens.length === 0 ? (
          <div className="text-sm text-gray-500">上の単語をクリックしてください（2語なら Shift+クリック）。</div>
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
              ※飛び飛びに選ばれている場合は、最小〜最大の連続範囲に自動補正して「まとまり」を作成します。
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
