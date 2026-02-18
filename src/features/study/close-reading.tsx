// src/features/study/close-reading.tsx
"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

type ID = string;

type NodeKind = "folder" | "file";

type Node = {
  id: ID;
  name: string;
  parentId: ID | null;
  kind: NodeKind;
};

type Role =
  | "S"
  | "S（同）"
  | "(S)"
  | "V"
  | "V（現完）"
  | "V（過完）"
  | "V（受）"
  | "V（否）"
  | "V（進）"
  | "V（過分）"
  | "V（現分）"
  | "(V)"
  | "O"
  | "(O)"
  | "C"
  | "C（現分）"
  | "C（過分）"
  | "(C)"
  | "M"
  | "(M)"
  | "M（同）"
  | "SV"
  | "VC"
  | "VO"
  | "VOM"
  | "OTHER"
  | "NONE";

type Detail =
  | "名"
  | "動"
  | "動名"
  | "不定"
  | "形"
  | "副"
  | "前"
  | "冠"
  | "代"
  | "複代" // ★追加: 複合関係代名詞
  | "助"
  | "接"
  | "従"
  | "等"
  | "自"
  | "他"
  | "数"
  | "<自>"
  | "<他>"
  | "NONE";

type SpanKind = "PHRASE" | "CLAUSE";

type Token = {
  id: string;
  text: string;
  // role, detail は v7 で廃止/移行（グループ管理へ）
  // ただし ja は単語ごとの訳として残す
  ja?: string;
};

// 下線（SVOCM）用のグループ
type Group = {
  id: string;
  tokenIds: string[];
  role: Role;
  ja?: string;
};

// ★追加：上部詳細タグ（品詞）用のグループ
type DetailGroup = {
  id: string;
  tokenIds: string[]; // tokens順に正規化
  detail: Detail;
};

// ★追加：熟語（イディオム）用のグループ
type Idiom = {
  id: string;
  tokenIds: string[];
  ja?: string;
};

// ★修正：Spanにdetail（品詞）を追加
type Span = {
  id: string;
  kind: SpanKind;
  tokenIds: string[];
  detail?: Detail; // 括弧自体に付与する品詞（例：名詞節など）
};

// --- Legacy Stores for Migration ---
type StoreV1 = { version: 1; inputText: string; tokens: { id: string; text: string; role: Role }[]; updatedAt: number };
// V2~V5 omitted for brevity, logic handled in migration

type StoreV6 = {
  version: 6;
  inputText: string;
  tokens: { id: string; text: string; role: Role; detail: Detail; ja?: string }[];
  groups: Group[];
  spans: Span[];
  updatedAt: number;
};

// ★New Store Version
type StoreV7 = {
  version: 7;
  inputText: string;
  tokens: Token[];
  groups: Group[];        // 下の役割 (SVOCM)
  detailGroups: DetailGroup[]; // ★上の詳細タグ (品詞)
  idioms: Idiom[];        // ★熟語（金色の枠線）
  spans: Span[];          // 括弧
  updatedAt: number;
};

type Doc = StoreV7;

type Store = {
  version: 1;
  nodes: Record<ID, Node>;
  files: Record<ID, Doc>;
  currentFolderId: ID | null;
  currentFileId: ID | null;
};

const LOCAL_KEY = "study_close_reading_v1";
const DOC_KEY = "study_close_reading_v1";

const SYNC_CHANNEL = "support-ai-sync";
const STORAGE_KEY_RESET_REQ = "support-ai:sync:reset:req";
const LOCAL_APPLIED_TYPE = "LOCAL_DOC_APPLIED";

const ROLE_LABELS: { role: Role; label: string }[] = [
  { role: "S", label: "S（主語）" },
  { role: "S（同）", label: "S（同）(同格語)" },
  { role: "(S)", label: "（S）(準動詞)" },
  { role: "V", label: "V（動詞）" },
  { role: "V（現完）", label: "V（現完）" },
  { role: "V（過完）", label: "V（過完）" },
  { role: "V（受）", label: "V（受）" },
  { role: "V（否）", label: "V（否）" },
  { role: "V（進）", label: "V（進）" },
  { role: "V（過分）", label: "V（過分）" },
  { role: "V（現分）", label: "V（現分）" },
  { role: "(V)", label: "（V）(準動詞)" },
  { role: "O", label: "O（目的語）" },
  { role: "(O)", label: "（O）(準動詞)" },
  { role: "C", label: "C（補語）" },
  { role: "C（現分）", label: "C（現分）" },
  { role: "C（過分）", label: "C（過分）" },
  { role: "(C)", label: "（C）(準動詞)" },
  { role: "M", label: "M（修飾）" },
  { role: "(M)", label: "（M）(準動詞)" },
  { role: "M（同）", label: "M（同）(同格語)" },
  { role: "SV", label: "SV" },
  { role: "VO", label: "VO" },
  { role: "VC", label: "VC" },
  { role: "VOM", label: "VOM" },
  { role: "OTHER", label: "その他" },
  { role: "NONE", label: "解除" },
];

const DETAIL_LABELS: { detail: Detail; label: string }[] = [
  { detail: "形", label: "形（形容詞）" },
  { detail: "副", label: "副（副詞）" },
  { detail: "名", label: "名（名詞）" },
  { detail: "代", label: "代（代名詞）" },
  { detail: "複代", label: "複代（複合関係代名詞）" }, // ★追加
  { detail: "動", label: "動（動詞）" },
  { detail: "動名", label: "動名（動名詞）" },
  { detail: "不定", label: "不定（不定詞）" },
  { detail: "自", label: "自（自動詞）" },
  { detail: "他", label: "他（他動詞）" },
  { detail: "数", label: "数（数詞）" },
  { detail: "前", label: "前（前置詞）" },
  { detail: "冠", label: "冠（冠詞）" },
  { detail: "助", label: "助（助動詞）" },
  { detail: "接", label: "接（接続詞）" },
  { detail: "従", label: "従（従属接続詞）" },
  { detail: "等", label: "等（等位・並列）" },
  { detail: "<自>", label: "準動詞 <自>" },
  { detail: "<他>", label: "準動詞 <他>" },
  { detail: "NONE", label: "解除" },
];

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function tokenize(text: string): Token[] {
  const seg =
    String.raw`(?:\d+(?:\.\d+)?[A-Za-z]+(?:'[A-Za-z]+)?|[A-Za-z]+(?:'[A-Za-z]+)?|\d+(?:\.\d+)?)`;

  const re = new RegExp(
    String.raw`\b(?:St|Mr|Ms)\.(?=\s|$)` +
      String.raw`|${seg}(?:-${seg})+` +
      String.raw`|\d+(?:\.\d+)?[A-Za-z]+(?:'[A-Za-z]+)?` +
      String.raw`|[A-Za-z]+(?:'[A-Za-z]+)?` +
      String.raw`|\d+(?:\.\d+)?` +
      String.raw`|[^\sA-Za-z0-9]`,
    "g"
  );

  const raw = text.match(re) ?? [];
  return raw.map((t) => ({
    id: newId(),
    text: t,
    ja: "",
  }));
}

function defaultDocV7(): StoreV7 {
  return {
    version: 7,
    inputText: "",
    tokens: [],
    groups: [],
    detailGroups: [],
    idioms: [],
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
  const seg =
    /^(?:\d+(?:\.\d+)?[A-Za-z]+(?:'[A-Za-z]+)?|[A-Za-z]+(?:'[A-Za-z]+)?|\d+(?:\.\d+)?)$/;
  const hyphenWord = new RegExp(
    String.raw`^(?:\d+(?:\.\d+)?[A-Za-z]+(?:'[A-Za-z]+)?|[A-Za-z]+(?:'[A-Za-z]+)?|\d+(?:\.\d+)?)(?:-(?:\d+(?:\.\d+)?[A-Za-z]+(?:'[A-Za-z]+)?|[A-Za-z]+(?:'[A-Za-z]+)?|\d+(?:\.\d+)?))+$`
  );

  return (
    /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(t) ||
    /^\d+(?:\.\d+)?$/.test(t) ||
    /^\d+(?:\.\d+)?[A-Za-z]+(?:'[A-Za-z]+)?$/.test(t) ||
    /^(?:St|Mr|Ms)\.$/.test(t) ||
    (seg.test(t) && hyphenWord.test(t)) ||
    hyphenWord.test(t)
  );
}

function isSpecialPunct(t: string) {
  return t === "," || t === "." || t === '"';
}

function shouldUnderlineToken(t: string) {
  return isWordToken(t);
}

function isJaTargetToken(t: string) {
  return isWordToken(t);
}

function classForRole(role: Role) {
  switch (role) {
    case "S":
    case "S（同）":
    case "(S)":
      return "bg-blue-100 text-blue-800 border-blue-200";

    case "V":
    case "V（現完）":
    case "V（過完）":
    case "V（受）":
    case "V（否）":
    case "V（進）":
    case "V（過分）":
    case "V（現分）":
    case "(V)":
      return "bg-red-100 text-red-800 border-red-200";

    case "O":
    case "(O)":
      return "bg-amber-100 text-amber-800 border-amber-200";

    case "C":
    case "C（現分）":
    case "C（過分）":
    case "(C)":
      return "bg-purple-100 text-purple-800 border-purple-200";

    case "M":
    case "(M)":
    case "M（同）":
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

function normalizeTokenIds(tokenIds: string[], idToIndex: Map<string, number>) {
  const dedup = Array.from(new Set(tokenIds));
  dedup.sort((a, b) => (idToIndex.get(a) ?? 1e9) - (idToIndex.get(b) ?? 1e9));
  return dedup;
}

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
  return b.start <= a.start && a.end <= b.end;
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return !(a.end < b.start || b.end < a.start);
}

function crosses(a: { start: number; end: number }, b: { start: number; end: number }) {
  if (!overlaps(a, b)) return false;
  if (isContained(a, b) || isContained(b, a)) return false;
  return true;
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}
function uniqueStringsPreserveOrder(xs: string[]) {
  return Array.from(new Set(xs));
}

function migrateDoc(raw: any): StoreV7 {
  const base = defaultDocV7();
  if (!raw || typeof raw !== "object") return base;

  // Common normalizers
  const normalizeTokens = (tokensIn: any[]): Token[] =>
    (Array.isArray(tokensIn) ? tokensIn : [])
      .map((x: any) => {
        if (!x || typeof x !== "object") return null;
        const text = typeof x.text === "string" ? x.text : null;
        if (!text) return null;
        const ja = typeof x.ja === "string" ? x.ja : "";
        return {
          id: typeof x.id === "string" ? x.id : newId(),
          text,
          ja,
        } satisfies Token;
      })
      .filter(Boolean) as Token[];

  const normalizeGroups = (
    groupsIn: any[],
    tokenSet: Set<string>,
    idToIndex: Map<string, number>
  ): Group[] =>
    (Array.isArray(groupsIn) ? groupsIn : [])
      .map((g: any) => {
        if (!g || typeof g !== "object") return null;
        const role = typeof g.role === "string" ? (g.role as Role) : "NONE";
        const tokenIdsRaw: string[] = Array.isArray(g.tokenIds)
          ? (g.tokenIds as unknown[]).filter(isString).filter((id) => tokenSet.has(id))
          : [];
        if (tokenIdsRaw.length === 0) return null;
        const ja = typeof g.ja === "string" ? g.ja : "";
        return {
          id: typeof g.id === "string" ? g.id : newId(),
          role,
          tokenIds: normalizeTokenIds(uniqueStringsPreserveOrder(tokenIdsRaw), idToIndex),
          ja,
        } satisfies Group;
      })
      .filter(Boolean) as Group[];

  const normalizeDetailGroups = (
    dGroupsIn: any[],
    tokenSet: Set<string>,
    idToIndex: Map<string, number>
  ): DetailGroup[] =>
    (Array.isArray(dGroupsIn) ? dGroupsIn : [])
      .map((g: any) => {
        if (!g || typeof g !== "object") return null;
        const detail = typeof g.detail === "string" ? (g.detail as Detail) : "NONE";
        const tokenIdsRaw: string[] = Array.isArray(g.tokenIds)
          ? (g.tokenIds as unknown[]).filter(isString).filter((id) => tokenSet.has(id))
          : [];
        if (tokenIdsRaw.length === 0) return null;
        return {
          id: typeof g.id === "string" ? g.id : newId(),
          detail,
          tokenIds: normalizeTokenIds(uniqueStringsPreserveOrder(tokenIdsRaw), idToIndex),
        } satisfies DetailGroup;
      })
      .filter(Boolean) as DetailGroup[];

  const normalizeIdioms = (
    idiomsIn: any[],
    tokenSet: Set<string>,
    idToIndex: Map<string, number>
  ): Idiom[] => 
    (Array.isArray(idiomsIn) ? idiomsIn : [])
      .map((g: any) => {
        if (!g || typeof g !== "object") return null;
        const tokenIdsRaw: string[] = Array.isArray(g.tokenIds)
          ? (g.tokenIds as unknown[]).filter(isString).filter((id) => tokenSet.has(id))
          : [];
        if (tokenIdsRaw.length === 0) return null;
        const ja = typeof g.ja === "string" ? g.ja : "";
        return {
          id: typeof g.id === "string" ? g.id : newId(),
          tokenIds: normalizeTokenIds(uniqueStringsPreserveOrder(tokenIdsRaw), idToIndex),
          ja,
        } satisfies Idiom;
      })
      .filter(Boolean) as Idiom[];

  const normalizeSpans = (
    spansIn: any[],
    tokenSet: Set<string>,
    idToIndex: Map<string, number>
  ): Span[] =>
    (Array.isArray(spansIn) ? spansIn : [])
      .map((s: any) => {
        if (!s || typeof s !== "object") return null;
        const kind = s.kind === "CLAUSE" || s.kind === "PHRASE" ? (s.kind as SpanKind) : null;
        if (!kind) return null;
        const tokenIdsRaw: string[] = Array.isArray(s.tokenIds)
          ? uniqueStringsPreserveOrder((s.tokenIds as unknown[]).filter(isString)).filter((id) =>
              tokenSet.has(id)
            )
          : [];
        if (tokenIdsRaw.length === 0) return null;
        
        const detail = typeof s.detail === "string" ? (s.detail as Detail) : undefined;

        return {
          id: typeof s.id === "string" ? s.id : newId(),
          kind,
          tokenIds: normalizeTokenIds(tokenIdsRaw, idToIndex),
          detail,
        } satisfies Span;
      })
      .filter(Boolean) as Span[];

  if (raw.version === 7) {
    const inputText = typeof raw.inputText === "string" ? raw.inputText : "";
    const tokens = normalizeTokens(raw.tokens);
    const idToIndex = new Map(tokens.map((t, i) => [t.id, i]));
    const tokenSet = new Set(tokens.map((t) => t.id));
    const groups = normalizeGroups(raw.groups, tokenSet, idToIndex);
    const detailGroups = normalizeDetailGroups(raw.detailGroups, tokenSet, idToIndex);
    const idioms = normalizeIdioms(raw.idioms, tokenSet, idToIndex);
    const spans = normalizeSpans(raw.spans, tokenSet, idToIndex);
    const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now();
    return { version: 7, inputText, tokens, groups, detailGroups, idioms, spans, updatedAt };
  }

  // Migration from V6 or lower -> V7
  // V6 had `token.detail`. We need to convert these to `DetailGroup`.
  if (
    raw.version === 6 ||
    raw.version === 5 ||
    raw.version === 4 ||
    raw.version === 3 ||
    raw.version === 2 ||
    raw.version === 1
  ) {
    // Treat V1-V6 roughly the same for token extraction, but V6 has detail
    const rawTokens = Array.isArray(raw.tokens) ? raw.tokens : [];
    const tokens: Token[] = [];
    const detailGroups: DetailGroup[] = [];
      
    // Extract tokens and convert details
    rawTokens.forEach((rt: any) => {
        if (!rt || typeof rt !== 'object') return;
        const tId = typeof rt.id === 'string' ? rt.id : newId();
        const text = typeof rt.text === 'string' ? rt.text : '';
        const ja = typeof rt.ja === 'string' ? rt.ja : '';
        if (!text) return;
        
        tokens.push({ id: tId, text, ja });

        const detail = typeof rt.detail === 'string' ? (rt.detail as Detail) : "NONE";
        if (detail !== "NONE") {
            detailGroups.push({
                id: newId(),
                tokenIds: [tId],
                detail
            });
        }
    });

    const idToIndex = new Map(tokens.map((t, i) => [t.id, i]));
    const tokenSet = new Set(tokens.map((t) => t.id));

    // For V1, we need to create groups from roles
    let groups: Group[] = [];
    if (raw.version === 1) {
       rawTokens.forEach((rt: any) => {
           if(rt.role && rt.role !== "NONE" && typeof rt.role === "string" && typeof rt.id === "string") {
               groups.push({ id: newId(), tokenIds: [rt.id], role: rt.role as Role, ja: "" });
           }
       });
    } else {
       groups = normalizeGroups(raw.groups, tokenSet, idToIndex);
    }
      
    const spans = normalizeSpans(raw.spans, tokenSet, idToIndex);
    const inputText = typeof raw.inputText === "string" ? raw.inputText : "";
    const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now();

    return { version: 7, inputText, tokens, groups, detailGroups, idioms: [], spans, updatedAt };
  }

  return base;
}

// ----------------- Tree store (Local) -----------------
function createDefaultStore(): Store {
  const rootId = uid();
  const rootNode: Node = { id: rootId, name: "Close Reading", parentId: null, kind: "folder" };

  return {
    version: 1,
    nodes: { [rootId]: rootNode },
    files: {},
    currentFolderId: rootId,
    currentFileId: null,
  };
}

function normalizeStore(raw: any): Store {
  const def = createDefaultStore();
  if (!raw || typeof raw !== "object") return def;

  if (raw.version === 1 && raw.nodes && raw.files) {
    const nodesIn = raw.nodes as any;
    const filesIn = raw.files as any;

    const nodes: Record<ID, Node> = {};
    for (const [id, n] of Object.entries(nodesIn ?? {})) {
      const nn = n as any;
      const kind: NodeKind = nn?.kind === "file" ? "file" : "folder";
      const name = typeof nn?.name === "string" ? nn.name : kind === "folder" ? "Folder" : "Deck";
      const parentId = nn?.parentId === null || typeof nn?.parentId === "string" ? nn.parentId : null;
      nodes[id] = { id, name, parentId, kind };
    }

    const hasAnyNode = Object.keys(nodes).length > 0;
    const nodes2 = hasAnyNode ? nodes : def.nodes;

    const files: Record<ID, Doc> = {};
    for (const [fid, f] of Object.entries(filesIn ?? {})) {
      files[fid] = migrateDoc(f);
    }

    const currentFolderId =
      raw.currentFolderId === null || typeof raw.currentFolderId === "string"
        ? raw.currentFolderId
        : def.currentFolderId;
    const currentFileId =
      raw.currentFileId === null || typeof raw.currentFileId === "string" ? raw.currentFileId : null;

    const safeFolderId =
      currentFolderId && nodes2[currentFolderId]?.kind === "folder" ? currentFolderId : def.currentFolderId;
    const safeFileId = currentFileId && nodes2[currentFileId]?.kind === "file" && files[currentFileId] ? currentFileId : null;

    return {
      version: 1,
      nodes: nodes2,
      files,
      currentFolderId: safeFolderId,
      currentFileId: safeFileId,
    };
  }

  const doc = migrateDoc(raw);

  const s = createDefaultStore();
  const fileId = uid();

  s.nodes[fileId] = {
    id: fileId,
    name: "精読ノート 1",
    parentId: s.currentFolderId,
    kind: "file",
  };
  s.files[fileId] = doc;
  s.currentFileId = fileId;

  return s;
}

function loadLocal(): Store {
  if (typeof window === "undefined") return createDefaultStore();
  const raw = safeParseJSON<any>(localStorage.getItem(LOCAL_KEY));
  return normalizeStore(raw);
}

function saveLocal(s: Store) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn("[close-reading] saveLocal failed:", e);
  }
}

function joinTokensForDisplay(tokens: string[]) {
  const noSpaceBefore = new Set([",", ".", "!", "?", ";", ":", ")", "]"]);
  const noSpaceAfter = new Set(["(", "["]);

  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : "";
    const needSpace = i > 0 && !noSpaceBefore.has(t) && !noSpaceAfter.has(prev) && prev !== "";
    out += (needSpace ? " " : "") + t;
  }
  return out.trim();
}

export default function CloseReading() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef<Store>(store);

  const [newFolderName, setNewFolderName] = useState("");
  const [newFileName, setNewFileName] = useState("");

  const nodes = store.nodes;
  const currentFolderId = store.currentFolderId;
  const currentFileId = store.currentFileId;

  const currentDoc: Doc | null = currentFileId ? store.files[currentFileId] ?? null : null;
  const currentFileName = currentFileId ? nodes[currentFileId]?.name ?? "" : "";

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // ★追加：括弧そのものを選択している場合のID
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  const anchorIndexRef = useRef<number | null>(null);

  const [jaCursor, setJaCursor] = useState(0);
  const jaInputRef = useRef<HTMLTextAreaElement | null>(null);

  // ★追加: 熟語の座標計算用
  const [idiomPositions, setIdiomPositions] = useState<Record<string, { left: number; top: number }>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedIds([]);
    setSelectedSpanId(null);
    anchorIndexRef.current = null;
    setJaCursor(0);
  }, [currentFileId]);

  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const doPull = async () => {
      try {
        const remote = await loadUserDoc<any>(DOC_KEY);
        const normalized = normalizeStore(remote);
        setStore(normalized);
        saveLocal(normalized);
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
        if (parsed) setStore(normalizeStore(parsed));
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

  const children = useMemo(() => {
    const list = Object.values(nodes).filter((n) => n.parentId === currentFolderId);
    return list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });
  }, [nodes, currentFolderId]);

  const breadcrumb = useMemo(() => {
    const items: Node[] = [];
    let curId = currentFolderId;
    while (curId) {
      const n = nodes[curId];
      if (!n) break;
      items.push(n);
      curId = n.parentId;
    }
    return items.reverse();
  }, [nodes, currentFolderId]);

  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    setStore((s) => {
      const id = uid();
      const node: Node = { id, name, parentId: s.currentFolderId, kind: "folder" };
      return { ...s, nodes: { ...s.nodes, [id]: node } };
    });
    setNewFolderName("");
  };

  const addFile = () => {
    const name = newFileName.trim();
    if (!name) return;
    setStore((s) => {
      const id = uid();
      const node: Node = { id, name, parentId: s.currentFolderId, kind: "file" };
      const doc: Doc = defaultDocV7();
      return {
        ...s,
        nodes: { ...s.nodes, [id]: node },
        files: { ...s.files, [id]: doc },
        currentFileId: id,
      };
    });
    setNewFileName("");
  };

  const openFolder = (id: ID) => {
    setStore((s) => ({
      ...s,
      currentFolderId: id,
      currentFileId: s.currentFileId && s.nodes[s.currentFileId]?.parentId === id ? s.currentFileId : null,
    }));
  };

  const openFile = (id: ID) => {
    setStore((s) => ({ ...s, currentFileId: id }));
  };

  const goUpFolder = () => {
    if (!currentFolderId) return;
    const cur = nodes[currentFolderId];
    if (!cur) return;
    setStore((s) => ({
      ...s,
      currentFolderId: cur.parentId,
      currentFileId: null,
    }));
  };

  const renameNode = (id: ID) => {
    const node = store.nodes[id];
    if (!node) return;
    const name = window.prompt("新しい名前を入力してください", node.name);
    if (!name) return;
    setStore((s) => ({
      ...s,
      nodes: { ...s.nodes, [id]: { ...s.nodes[id], name } },
    }));
  };

  const deleteFolder = (id: ID) => {
    if (!confirm("このフォルダと中身をすべて削除します。よろしいですか？")) return;

    setStore((s) => {
      const toDelete = new Set<ID>();
      const queue: ID[] = [id];

      while (queue.length > 0) {
        const cur = queue.shift()!;
        toDelete.add(cur);
        for (const n of Object.values(s.nodes)) {
          if (n.parentId === cur) queue.push(n.id);
        }
      }

      const nextNodes: Record<ID, Node> = {};
      const nextFiles: Record<ID, Doc> = {};

      for (const [nid, node] of Object.entries(s.nodes)) {
        if (!toDelete.has(nid)) nextNodes[nid] = node;
      }
      for (const [fid, file] of Object.entries(s.files)) {
        if (!toDelete.has(fid)) nextFiles[fid] = file;
      }

      const currentFolderIdNew = toDelete.has(s.currentFolderId ?? "") ? null : s.currentFolderId;
      const currentFileIdNew = toDelete.has(s.currentFileId ?? "") ? null : s.currentFileId;

      return {
        ...s,
        nodes: nextNodes,
        files: nextFiles,
        currentFolderId: currentFolderIdNew,
        currentFileId: currentFileIdNew,
      };
    });
  };

  const deleteFile = (id: ID) => {
    if (!confirm("このファイル（ノート）を削除します。よろしいですか？")) return;
    setStore((s) => {
      const nextNodes = { ...s.nodes };
      const nextFiles = { ...s.files };
      delete nextNodes[id];
      delete nextFiles[id];
      const currentFileIdNew = s.currentFileId === id ? null : s.currentFileId;
      return { ...s, nodes: nextNodes, files: nextFiles, currentFileId: currentFileIdNew };
    });
  };

  const updateCurrentDoc = (updater: (prev: Doc) => Doc) => {
    if (!currentFileId) return;
    setStore((s) => {
      const cur = s.files[currentFileId];
      if (!cur) return s;
      const next = updater(cur);
      return { ...s, files: { ...s.files, [currentFileId]: next } };
    });
  };

  const idToIndex = useMemo(
    () => new Map((currentDoc?.tokens ?? []).map((t, i) => [t.id, i])),
    [currentDoc?.tokens]
  );

  const groupByTokenId = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of currentDoc?.groups ?? []) for (const tid of g.tokenIds) m.set(tid, g);
    return m;
  }, [currentDoc?.groups]);

  // ★追加：DetailGroup lookup
  const detailGroupByTokenId = useMemo(() => {
    const m = new Map<string, DetailGroup>();
    for (const dg of currentDoc?.detailGroups ?? []) for (const tid of dg.tokenIds) m.set(tid, dg);
    return m;
  }, [currentDoc?.detailGroups]);

  // ★追加：Idiom lookup
  const idiomByTokenId = useMemo(() => {
    const m = new Map<string, Idiom>();
    for (const idm of currentDoc?.idioms ?? []) for (const tid of idm.tokenIds) m.set(tid, idm);
    return m;
  }, [currentDoc?.idioms]);

  const selectedTokens = useMemo(() => {
    const set = new Set(selectedIds);
    return (currentDoc?.tokens ?? []).filter((t) => set.has(t.id));
  }, [currentDoc?.tokens, selectedIds]);

  const selectedText = useMemo(
    () => joinTokensForDisplay(selectedTokens.map((t) => t.text)),
    [selectedTokens]
  );

  const selectedGroup = useMemo(() => {
    if (!currentDoc) return null;
    if (selectedIds.length === 0) return null;
    const groupIds = uniq(selectedIds.map((id) => groupByTokenId.get(id)?.id ?? "").filter((x) => x));
    if (groupIds.length !== 1) return null;
    return currentDoc.groups.find((g) => g.id === groupIds[0]) ?? null;
  }, [currentDoc, selectedIds, groupByTokenId]);

  const selectedDetailState = useMemo(() => {
    if (selectedTokens.length === 0) return "";
      
    // Check all selected tokens' details
    const details = uniq(selectedTokens.map(t => {
        const dg = detailGroupByTokenId.get(t.id);
        return dg ? dg.detail : "NONE";
    }));

    if (details.length === 1) return details[0] === "NONE" ? "NONE" : details[0];
    return "MIXED";
  }, [selectedTokens, detailGroupByTokenId]);

  const selectedIdiom = useMemo(() => {
      if (!currentDoc) return null;
      if (selectedIds.length === 0) return null;
      // すべての選択トークンが同じIdiomに属しているか？
      const idiomIds = uniq(selectedIds.map((id) => idiomByTokenId.get(id)?.id ?? "").filter((x) => x));
      if (idiomIds.length !== 1) return null;
      return currentDoc.idioms.find((i) => i.id === idiomIds[0]) ?? null;
  }, [currentDoc, selectedIds, idiomByTokenId]);

  const onBuild = () => {
    if (!currentDoc) return;
    const tokens = tokenize(currentDoc.inputText);
    updateCurrentDoc((prev) => ({
      ...prev,
      version: 7,
      tokens,
      groups: [],
      detailGroups: [],
      idioms: [],
      spans: [],
      updatedAt: Date.now(),
    }));
    setSelectedIds([]);
    setSelectedSpanId(null);
    anchorIndexRef.current = null;
    setJaCursor(0);
  };

  const onClearSVOCM = () => {
    if (!currentDoc) return;
    updateCurrentDoc((prev) => ({
      ...prev,
      groups: [],
      updatedAt: Date.now(),
    }));
  };

  const onClearBrackets = () => {
    if (!currentDoc) return;
    updateCurrentDoc((prev) => ({
      ...prev,
      spans: [],
      updatedAt: Date.now(),
    }));
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setSelectedSpanId(null);
    anchorIndexRef.current = null;
  };

  const onTokenClick = (index: number, id: string, ev: React.MouseEvent) => {
    const isShift = ev.shiftKey;
    const isMeta = ev.metaKey || ev.ctrlKey;

    if (!currentDoc) return;

    // トークンクリック時はSpan選択を解除
    setSelectedSpanId(null);

    if (isShift) {
      const anchor = anchorIndexRef.current ?? index;
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
      const rangeIds = currentDoc.tokens.slice(from, to + 1).map((t) => t.id);
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

  // ★追加：括弧（Span）をクリックしたときの処理
  const onSpanClick = (span: Span, ev: React.MouseEvent) => {
    ev.stopPropagation(); // トークンのクリックイベントなどを防ぐ
    // 括弧内のトークンIDをすべて選択状態にする（視覚的にもわかりやすく）
    setSelectedIds(span.tokenIds);
    // Span選択状態にする
    setSelectedSpanId(span.id);
  };

  const filterGroupEligibleIds = (ids: string[], tokens: Token[]) => {
    const map = new Map(tokens.map((t) => [t.id, t] as const));
    const allowPunct = ids.length >= 2;

    const kept = ids.filter((id) => {
      const t = map.get(id);
      if (!t) return false;
      if (shouldUnderlineToken(t.text)) return true;
      if (allowPunct && isSpecialPunct(t.text)) return true;
      return false;
    });

    const hasWord = kept.some((id) => {
      const t = map.get(id);
      return t ? isWordToken(t.text) : false;
    });
    return hasWord ? kept : [];
  };

  // SVOCM roles
  const setRoleToSelected = (role: Role) => {
    if (!currentDoc) return;
    if (selectedIds.length === 0) return;

    const coerced0 = coerceToContiguousSelection(selectedIds, idToIndex, currentDoc.tokens);
    const coerced = filterGroupEligibleIds(coerced0, currentDoc.tokens);
    if (coerced.length === 0) return;

    const selectedSet = new Set(coerced);

    if (selectedGroup) {
      const gSet = new Set(selectedGroup.tokenIds);
      const same =
        selectedGroup.tokenIds.length === coerced.length && coerced.every((x) => gSet.has(x));
      if (same) {
        updateCurrentDoc((prev) => ({
          ...prev,
          groups: prev.groups.map((g) => (g.id === selectedGroup.id ? { ...g, role } : g)),
          updatedAt: Date.now(),
        }));
        setSelectedIds(coerced);
        return;
      }
    }

    updateCurrentDoc((prev) => {
      const idToIndex2 = new Map(prev.tokens.map((t, i) => [t.id, i]));

      const nextGroups: Group[] = [];
      for (const g of prev.groups) {
        const rest = g.tokenIds.filter((tid) => !selectedSet.has(tid));
        if (rest.length > 0) {
          nextGroups.push({
            ...g,
            tokenIds: normalizeTokenIds(rest, idToIndex2),
            ja: typeof g.ja === "string" ? g.ja : "",
          });
        }
      }

      nextGroups.push({
        id: newId(),
        tokenIds: normalizeTokenIds(coerced, idToIndex2),
        role,
        ja: "",
      });

      nextGroups.sort((a, b) => {
        const amin = Math.min(...a.tokenIds.map((id) => idToIndex2.get(id) ?? 1e9));
        const bmin = Math.min(...b.tokenIds.map((id) => idToIndex2.get(id) ?? 1e9));
        return amin - bmin;
      });

      return { ...prev, groups: nextGroups, updatedAt: Date.now() };
    });

    setSelectedIds(coerced);
  };

  // ★詳細タグ（品詞）の設定
  const setDetailToSelected = (detail: Detail) => {
    if (!currentDoc) return;
    
    // ★Span選択モードの場合：選択中のSpanに対してdetailを付与する
    if (selectedSpanId) {
        updateCurrentDoc((prev) => ({
            ...prev,
            spans: prev.spans.map(s => {
                if (s.id !== selectedSpanId) return s;
                return { ...s, detail: detail === "NONE" ? undefined : detail };
            }),
            updatedAt: Date.now()
        }));
        return;
    }

    if (selectedIds.length === 0) return;

    // 連続範囲に補正
    const coerced = coerceToContiguousSelection(selectedIds, idToIndex, currentDoc.tokens);
    const set = new Set(coerced);

    updateCurrentDoc((prev) => {
        const idToIndex2 = new Map(prev.tokens.map((t, i) => [t.id, i]));
        
        // 既存のDetailGroupから、選択されたトークンを削除する（再編）
        const nextDetailGroups: DetailGroup[] = [];
        for (const dg of prev.detailGroups) {
            const remaining = dg.tokenIds.filter(tid => !set.has(tid));
            if (remaining.length > 0) {
                  nextDetailGroups.push({
                    ...dg,
                    tokenIds: normalizeTokenIds(remaining, idToIndex2)
                  });
            }
        }

        // Add new group if not NONE
        if (detail !== "NONE") {
            nextDetailGroups.push({
                id: newId(),
                tokenIds: normalizeTokenIds(coerced, idToIndex2),
                detail
            });
        }

        nextDetailGroups.sort((a, b) => {
             const amin = Math.min(...a.tokenIds.map((id) => idToIndex2.get(id) ?? 1e9));
             const bmin = Math.min(...b.tokenIds.map((id) => idToIndex2.get(id) ?? 1e9));
             return amin - bmin;
        });

        return { ...prev, detailGroups: nextDetailGroups, updatedAt: Date.now() };
    });

    setSelectedIds(coerced);
  };

  // ★熟語の設定
  const setIdiomToSelected = () => {
      if (!currentDoc) return;
      if (selectedIds.length === 0) return;

      const coerced = coerceToContiguousSelection(selectedIds, idToIndex, currentDoc.tokens);
      const set = new Set(coerced);

      updateCurrentDoc((prev) => {
          const idToIndex2 = new Map(prev.tokens.map((t, i) => [t.id, i]));
          
          // 既存のIdiomから、選択されたトークンを削除（上書き）
          const nextIdioms: Idiom[] = [];
          for (const idm of prev.idioms) {
              const remaining = idm.tokenIds.filter(tid => !set.has(tid));
              // 分断されたら別々のIdiomとして残すロジックは複雑になるため、
              // 単純に残った部分だけ維持する（分断時は片方だけ残る等の簡易挙動）
              if (remaining.length > 0) {
                  nextIdioms.push({
                      ...idm,
                      tokenIds: normalizeTokenIds(remaining, idToIndex2)
                  });
              }
          }

          nextIdioms.push({
              id: newId(),
              tokenIds: normalizeTokenIds(coerced, idToIndex2),
              ja: ""
          });

          nextIdioms.sort((a, b) => {
              const amin = Math.min(...a.tokenIds.map((id) => idToIndex2.get(id) ?? 1e9));
              const bmin = Math.min(...b.tokenIds.map((id) => idToIndex2.get(id) ?? 1e9));
              return amin - bmin;
          });

          return { ...prev, idioms: nextIdioms, updatedAt: Date.now() };
      });
      setSelectedIds(coerced);
  };

  const clearIdiomFromSelected = () => {
      if (!currentDoc) return;
      if (selectedIds.length === 0) return;
      
      const set = new Set(selectedIds);
      
      updateCurrentDoc((prev) => {
          const idToIndex2 = new Map(prev.tokens.map((t, i) => [t.id, i]));
          const nextIdioms: Idiom[] = [];

          for (const idm of prev.idioms) {
              const remaining = idm.tokenIds.filter(tid => !set.has(tid));
              if (remaining.length > 0) {
                  nextIdioms.push({
                      ...idm,
                      tokenIds: normalizeTokenIds(remaining, idToIndex2)
                  });
              }
          }
          return { ...prev, idioms: nextIdioms, updatedAt: Date.now() };
      });
  };

  const setSpanToSelected = (kind: SpanKind) => {
    if (!currentDoc) return;
    if (selectedIds.length === 0) return;
    const coerced = coerceToContiguousSelection(selectedIds, idToIndex, currentDoc.tokens);

    updateCurrentDoc((prev) => {
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
          kind: s.kind === "CLAUSE" || s.kind === "PHRASE" ? (s.kind as SpanKind) : "PHRASE",
          tokenIds: normalizeTokenIds(
            (Array.isArray(s.tokenIds) ? (s.tokenIds as unknown[]).filter(isString) : []).filter((id) =>
              tokenSet.has(id)
            ),
            idToIndex2
          ),
          detail: s.detail // 既存のdetailを維持
        };
        if (s2.tokenIds.length === 0) continue;

        const r = spanRange(s2, idToIndex2);

        if (s2.kind === kind && r.start === newR.start && r.end === newR.end) continue;
        if (crosses(r, newR)) continue;

        kept.push(s2);
      }

      kept.push(newSpan);

      kept.sort((a, b) => {
        const ra = spanRange(a, idToIndex2);
        const rb = spanRange(b, idToIndex2);
        if (ra.start !== rb.start) return ra.start - rb.start;
        const la = ra.end - ra.start;
        const lb = rb.end - rb.start;
        if (la !== lb) return lb - la;
        if (a.kind !== b.kind) return a.kind === "CLAUSE" ? -1 : 1;
        return a.id.localeCompare(b.id);
      });

      return { ...prev, spans: kept, updatedAt: Date.now() };
    });

    setSelectedIds(coerced);
  };

  const removeSpansOverlappingSelection = () => {
    if (!currentDoc) return;
    if (selectedIds.length === 0) return;
    const coerced = coerceToContiguousSelection(selectedIds, idToIndex, currentDoc.tokens);

    updateCurrentDoc((prev) => {
      const idToIndex2 = new Map(prev.tokens.map((t, i) => [t.id, i]));
      const selR = (() => {
        const idxs = coerced.map((id) => idToIndex2.get(id)).filter((x): x is number => typeof x === "number");
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

  const setJaToGroup = (groupId: string, ja: string) => {
    if (!currentDoc) return;
    updateCurrentDoc((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === groupId ? { ...g, ja } : g)),
      updatedAt: Date.now(),
    }));
  };

  const setJaToToken = (tokenId: string, ja: string) => {
    if (!currentDoc) return;
    updateCurrentDoc((prev) => ({
      ...prev,
      tokens: prev.tokens.map((t) => (t.id === tokenId ? { ...t, ja } : t)),
      updatedAt: Date.now(),
    }));
  };

  const setJaToIdiom = (idiomId: string, ja: string) => {
      if (!currentDoc) return;
      updateCurrentDoc((prev) => ({
        ...prev,
        idioms: prev.idioms.map((i) => (i.id === idiomId ? { ...i, ja } : i)),
        updatedAt: Date.now(),
      }));
  };

  const autoHint = () => {
    if (!currentDoc) return;

    const vSet = new Set([
      "am", "is", "are", "was", "were", "be", "been", "being",
      "do", "does", "did", "have", "has", "had",
      "can", "could", "will", "would", "shall", "should", "may", "might", "must",
      "live", "exists", "exist", "make", "made", "give", "gave", "get", "got", "go", "went",
    ]);

    updateCurrentDoc((prev) => {
      const idToIndex2 = new Map(prev.tokens.map((t, i) => [t.id, i]));
      const tokenSetInGroups = new Set(prev.groups.flatMap((g) => g.tokenIds));
      
      const nextGroups = [...prev.groups];
      const nextDetailGroups = [...prev.detailGroups];
      
      // Existing detail coverage
      const coveredByDetail = new Set(prev.detailGroups.flatMap(g => g.tokenIds));

      for (const t of prev.tokens) {
        if (!isWordToken(t.text)) continue;
        const key = t.text.toLowerCase();
        if (!vSet.has(key)) continue;

        // SVOCM hint
        if (!tokenSetInGroups.has(t.id)) {
            nextGroups.push({ id: newId(), tokenIds: [t.id], role: "V", ja: "" });
            tokenSetInGroups.add(t.id);
        }

        // Detail hint
        if (!coveredByDetail.has(t.id)) {
             nextDetailGroups.push({ id: newId(), tokenIds: [t.id], detail: "動" });
             coveredByDetail.add(t.id);
        }
      }

      for (const g of nextGroups) g.tokenIds = normalizeTokenIds(g.tokenIds, idToIndex2);
      nextGroups.sort((a, b) => {
        const amin = Math.min(...a.tokenIds.map((id) => idToIndex2.get(id) ?? 1e9));
        const bmin = Math.min(...b.tokenIds.map((id) => idToIndex2.get(id) ?? 1e9));
        return amin - bmin;
      });

      return { ...prev, groups: nextGroups, detailGroups: nextDetailGroups, updatedAt: Date.now() };
    });
  };

  const roleHintText =
    selectedTokens.length >= 2 ? `（${selectedTokens.length}語）` : selectedTokens.length === 1 ? "（1語）" : "";

  const displayUnits = useMemo(() => {
    const doc = currentDoc;
    if (!doc) return [];

    const tokenToGroup = new Map<string, Group>();
    for (const g of doc.groups) for (const tid of g.tokenIds) tokenToGroup.set(tid, g);

    const started = new Set<string>();
    const units: {
      tokenIds: string[];
      roleToShow: Role;
      groupId: string | null;
      groupJa: string;
      tokenJa: string;
    }[] = [];

    for (let i = 0; i < doc.tokens.length; i++) {
      const t = doc.tokens[i];
      const g = tokenToGroup.get(t.id);

      if (!g) {
        units.push({
          tokenIds: [t.id],
          roleToShow: "NONE",
          groupId: null,
          groupJa: "",
          tokenJa: typeof t.ja === "string" ? t.ja : "",
        });
        continue;
      }

      if (started.has(g.id)) continue;
      started.add(g.id);

      const orderedCore = normalizeTokenIds(g.tokenIds, idToIndex);
      const idxs = orderedCore.map((id) => idToIndex.get(id)).filter((x): x is number => typeof x === "number");
      if (idxs.length === 0) continue;

      const start = Math.min(...idxs);
      const end = Math.max(...idxs);

      const displayTokenIds = doc.tokens.slice(start, end + 1).map((x) => x.id);

      units.push({
        tokenIds: displayTokenIds,
        roleToShow: g.role,
        groupId: g.id,
        groupJa: typeof g.ja === "string" ? g.ja : "",
        tokenJa: "",
      });

      i = end;
    }

    return units;
  }, [currentDoc, idToIndex]);

  const spanMarksByTokenId = useMemo(() => {
    const doc = currentDoc;
    // 修正: 値を {char: string, span: Span}[] に変更し、Spanオブジェクトを持たせる
    const starts = new Map<string, { char: string; span: Span }[]>();
    const ends = new Map<string, { char: string; span: Span }[]>();
    if (!doc) return { starts, ends };

    const spans = doc.spans ?? [];
    const enriched = spans
      .map((s) => {
        const r = spanRange(s, idToIndex);
        return { s, r, len: r.end - r.start };
      })
      .filter((x) => x.r.end >= x.r.start);

    enriched
      .slice()
      .sort((a, b) => (a.r.start !== b.r.start ? a.r.start - b.r.start : b.len - a.len))
      .forEach(({ s }) => {
        const open = spanMarkers(s.kind).open;
        
        // ★修正: detailがある場合は括弧と一緒に表示
        const label = s.detail ? `${open}${s.detail}` : open;

        const first = s.tokenIds[0];
        if (!first) return;
        const arr = starts.get(first) ?? [];
        arr.push({ char: label, span: s });
        starts.set(first, arr);
      });

    enriched
      .slice()
      .sort((a, b) => (a.r.end !== b.r.end ? a.r.end - b.r.end : a.len - b.len))
      .forEach(({ s }) => {
        const close = spanMarkers(s.kind).close;
        const last = s.tokenIds[s.tokenIds.length - 1];
        if (!last) return;
        const arr = ends.get(last) ?? [];
        arr.push({ char: close, span: s });
        ends.set(last, arr);
      });

    return { starts, ends };
  }, [currentDoc, idToIndex]);

  type JaTarget =
    | { kind: "group"; id: string; role: Role; tokenIds: string[]; text: string; ja: string; sortIndex: number }
    | { kind: "token"; id: string; tokenId: string; text: string; ja: string; sortIndex: number }
    | { kind: "idiom"; id: string; text: string; ja: string; sortIndex: number };

  const jaTargets = useMemo<JaTarget[]>(() => {
    const doc = currentDoc;
    if (!doc) return [];

    const targets: JaTarget[] = [];
    
    // ★追加: 熟語に含まれるトークンIDのセットを作成
    const idiomTokenSet = new Set<string>();
    for (const idm of doc.idioms) {
      idm.tokenIds.forEach(id => idiomTokenSet.add(id));
    }
    
    // 1. SVOCM Groups & Tokens
    for (const u of displayUnits) {
      // ソート用のインデックス（ユニットの開始位置）
      const minIndex = u.tokenIds.length > 0 ? idToIndex.get(u.tokenIds[0]) ?? -1 : -1;
      
      // ★追加: 熟語に含まれているトークンを持つユニットはスキップ
      // (一部でも含まれていれば熟語優先とする)
      const isIncludedInIdiom = u.tokenIds.some(id => idiomTokenSet.has(id));
      if (isIncludedInIdiom) {
          continue;
      }
      
      if (u.groupId) {
        const words = u.tokenIds
          .map((id) => doc.tokens[idToIndex.get(id) ?? -1]?.text)
          .filter((x): x is string => typeof x === "string");

        const visibleWords = words.filter((t) => isJaTargetToken(t));
        if (visibleWords.length === 0) continue;

        targets.push({
          kind: "group",
          id: `g:${u.groupId}`,
          role: u.roleToShow,
          tokenIds: u.tokenIds,
          text: joinTokensForDisplay(words),
          ja: (u.groupJa ?? "").trim(),
          sortIndex: minIndex
        });
      } else {
        const tid = u.tokenIds[0];
        const tok = tid ? doc.tokens[idToIndex.get(tid) ?? -1] : null;
        if (!tok) continue;
        if (!isJaTargetToken(tok.text)) continue;

        targets.push({
          kind: "token",
          id: `t:${tok.id}`,
          tokenId: tok.id,
          text: tok.text,
          ja: (tok.ja ?? "").trim(),
          sortIndex: minIndex
        });
      }
    }

    // 2. Idioms
    for (const idm of doc.idioms) {
        if (idm.tokenIds.length === 0) continue;
        const minIndex = idToIndex.get(idm.tokenIds[0]) ?? -1;
        const words = idm.tokenIds
          .map((id) => doc.tokens[idToIndex.get(id) ?? -1]?.text)
          .filter((x): x is string => typeof x === "string");
        
        targets.push({
            kind: "idiom",
            id: `i:${idm.id}`,
            text: joinTokensForDisplay(words),
            ja: (idm.ja ?? "").trim(),
            sortIndex: minIndex
        });
    }

    // Sort by appearance
    targets.sort((a, b) => {
        if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        return 0;
    });

    return targets;
  }, [currentDoc, displayUnits, idToIndex]);

  useEffect(() => {
    if (jaTargets.length === 0) {
      setJaCursor(0);
      return;
    }
    setJaCursor((p) => {
      if (p < 0) return 0;
      if (p >= jaTargets.length) return jaTargets.length - 1;
      return p;
    });
  }, [jaTargets.length]);

  const currentJaTarget = jaTargets.length > 0 ? jaTargets[jaCursor] : null;

  const focusJaInputSoon = () => {
    requestAnimationFrame(() => {
      try {
        jaInputRef.current?.focus();
      } catch {}
    });
  };

  const moveJaCursor = (delta: number) => {
    if (jaTargets.length === 0) return;
    setJaCursor((p) => (p + delta + jaTargets.length) % jaTargets.length);
    focusJaInputSoon();
  };

  const onJaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      moveJaCursor(+1);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      moveJaCursor(-1);
      return;
    }
  };

  const onUpdateJaTarget = (value: string) => {
    if (!currentJaTarget) return;
    if (currentJaTarget.kind === "group") setJaToGroup(currentJaTarget.id.slice(2), value);
    else if (currentJaTarget.kind === "token") setJaToToken(currentJaTarget.tokenId, value);
    else if (currentJaTarget.kind === "idiom") setJaToIdiom(currentJaTarget.id.slice(2), value);
  };

  const jumpCursorToSelected = () => {
    if (jaTargets.length === 0) return;

    if (selectedIds.length === 1) {
      const tid = selectedIds[0];
      const idx = jaTargets.findIndex((t) => t.kind === "token" && t.tokenId === tid);
      if (idx >= 0) {
        setJaCursor(idx);
        focusJaInputSoon();
        return;
      }
    }

    if (selectedGroup) {
      const idx = jaTargets.findIndex((t) => t.kind === "group" && t.id === `g:${selectedGroup.id}`);
      if (idx >= 0) {
        setJaCursor(idx);
        focusJaInputSoon();
        return; // Return added
      }
    }

    if (selectedIdiom) {
        const idx = jaTargets.findIndex((t) => t.kind === "idiom" && t.id === `i:${selectedIdiom.id}`);
        if (idx >= 0) {
            setJaCursor(idx);
            focusJaInputSoon();
        }
    }
  };

  // ★追加: 熟語の座標計算用（DOM計測）
  // 熟語全体の真ん中（X軸）と、一番下（Y軸）を計算する
  
  useLayoutEffect(() => {
    if (!currentDoc) return;
    
    const calc = () => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newPos: Record<string, { left: number; top: number }> = {};

      currentDoc.idioms.forEach(idm => {
        if (idm.tokenIds.length === 0) return;
        
        let minLeft = Infinity;
        let maxRight = -Infinity;
        let maxBottom = -Infinity;
        let found = false;

        const idmSet = new Set(idm.tokenIds);
        const targetUnitStartIds: string[] = [];

        displayUnits.forEach(u => {
              if (u.tokenIds.some(t => idmSet.has(t))) {
                  if (u.tokenIds.length > 0) {
                      targetUnitStartIds.push(u.tokenIds[0]);
                  }
              }
        });

        targetUnitStartIds.forEach(uid => {
            const el = document.getElementById(`unit-${uid}`);
            if (el) {
                const r = el.getBoundingClientRect();
                if (r.left < minLeft) minLeft = r.left;
                if (r.right > maxRight) maxRight = r.right;
                if (r.bottom > maxBottom) maxBottom = r.bottom;
                found = true;
            }
        });

        if (found) {
              const left = (minLeft + maxRight) / 2 - containerRect.left;
              // 下線やラベルとの重なりを防ぐため、一番下のラインから少し下に配置
              // maxBottomは SVOCMラベル(roleText)や 訳スロット(jaText) を含んだUnit全体の底辺。
              // 訳スロット(jaText)は `invisible` で高さ確保されているため、maxBottomはその下端になる。
              // ★修正: 他のSVOCMと同じ高さにするため、確保されたスペース内（底辺から高さ分戻った位置）に配置
              const top = maxBottom - containerRect.top - 15; 
              newPos[idm.id] = { left, top };
        }
      });
      
      setIdiomPositions(newPos);
    };

    // 初回とリサイズ時、あとデータ変更時に計算
    const timer = setTimeout(calc, 0); // Wait for render
    window.addEventListener("resize", calc);
    return () => {
        clearTimeout(timer);
        window.removeEventListener("resize", calc);
    };
  }, [currentDoc, displayUnits]);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* Left tree */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">精読</h2>
          <span className="text-[11px] text-gray-500">1ファイル=1ノート</span>
        </div>

        <div className="mb-3 text-xs text-gray-600">
          <div className="mb-1 font-medium">現在のフォルダ</div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setStore((s) => ({ ...s, currentFolderId: null, currentFileId: null }))}
              className={
                "text-xs rounded-lg px-2 py-1 " +
                (currentFolderId === null ? "bg-black text-white" : "bg-gray-100 hover:bg-gray-200")
              }
            >
              ルート
            </button>
            {breadcrumb.map((b) => (
              <span key={b.id} className="flex items-center gap-1">
                <span className="text-gray-400">/</span>
                <button
                  type="button"
                  onClick={() => openFolder(b.id)}
                  className={
                    "text-xs rounded-lg px-2 py-1 " +
                    (currentFolderId === b.id ? "bg-black text-white" : "bg-gray-100 hover:bg-gray-200")
                  }
                >
                  {b.name}
                </button>
              </span>
            ))}
          </div>
        </div>

        {currentFolderId !== null && (
          <button type="button" onClick={goUpFolder} className="mb-3 text-xs text-gray-600 underline">
            上のフォルダに戻る
          </button>
        )}

        <div className="mb-3">
          {children.length === 0 ? (
            <p className="text-xs text-gray-500">このフォルダには、まだ何もありません。</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {children.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => (n.kind === "folder" ? openFolder(n.id) : openFile(n.id))}
                    className={
                      "flex-1 text-left rounded-xl px-3 py-1.5 border " +
                      (currentFileId === n.id ? "bg-blue-600 text-white" : "bg-white hover:bg-gray-50")
                    }
                  >
                    <span className="mr-2 text-xs text-gray-400">{n.kind === "folder" ? "📁" : "📝"}</span>
                    {n.name}
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => renameNode(n.id)}
                      className="text-xs rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                    >
                      名称変更
                    </button>
                    <button
                      type="button"
                      onClick={() => (n.kind === "folder" ? deleteFolder(n.id) : deleteFile(n.id))}
                      className="text-xs rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                    >
                      削除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add folder/file */}
        <div className="border-t pt-3 mt-3 space-y-3">
          <div>
            <h3 className="text-xs font-semibold mb-1">フォルダを追加</h3>
            <div className="flex gap-2">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="flex-1 rounded-xl border px-3 py-2 text-xs"
                placeholder="例: Unit1 / 長文 / 文法"
              />
              <button type="button" onClick={addFolder} className="rounded-xl bg-black px-3 py-2 text-xs text-white">
                追加
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold mb-1">ノート（ファイル）を追加</h3>
            <div className="flex gap-2">
              <input
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="flex-1 rounded-xl border px-3 py-2 text-xs"
                placeholder="例: 2026-02-02 精読1 / 重要長文A"
              />
              <button type="button" onClick={addFile} className="rounded-xl bg-black px-3 py-2 text-xs text-white">
                追加
              </button>
            </div>
          </div>

          <div className="text-[11px] text-gray-500 leading-relaxed">localStorage即時保存 / サーバ同期はホームの📥/☁のみ</div>
        </div>
      </section>

      {/* Right */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[200px]">
        {!currentDoc ? (
          <p className="text-sm text-gray-500">左のフォルダからノート（ファイル）を選択するか、新しいノートを作成してください。</p>
        ) : (
          <div className="mx-auto max-w-5xl space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold">精読（上：詳細 / 下：SVOCM / 括弧：[ ] ( ) / まとまり訳）</h1>
                <div className="text-xs text-gray-500 mt-1">ノート：{currentFileName || "（名称未設定）"}</div>
              </div>
              <div className="text-xs text-gray-500">更新: {new Date(currentDoc.updatedAt).toLocaleString()}</div>
            </div>

            {/* 入力 */}
            <div className="rounded-2xl border bg-white p-4 space-y-3 shadow-sm">
              <div className="text-sm font-medium">英文を入力</div>
              <textarea
                className="w-full min-h-[110px] rounded-xl border p-3 text-sm outline-none focus:ring-2 focus:ring-gray-200"
                placeholder='例: Every living thing exists (in a particular place), and that place has certain conditions.'
                value={currentDoc.inputText}
                onChange={(e) =>
                  updateCurrentDoc((prev) => ({
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
                  disabled={currentDoc.tokens.length === 0}
                >
                  下（SVOCM）を全解除（グループ訳も消えます）
                </button>

                <button
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={onClearBrackets}
                  disabled={currentDoc.tokens.length === 0}
                >
                  括弧（[ ] / ( )）を全解除
                </button>

                <button
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={autoHint}
                  disabled={currentDoc.tokens.length === 0}
                  title="超簡易のV候補だけ自動で付与（精度は高くない）"
                >
                  自動ヒント（V候補）
                </button>
              </div>

              <div className="text-xs text-gray-500">
                選択：クリック=1語 / Shift+クリック=範囲（置き換えで安定） / Ctrl(or Cmd)+クリック=追加/解除
              </div>
              <div className="text-xs text-gray-500">
                ※「,」「.」「&quot;」は単体では下線を引きません（ただし複数選択でグループ化すると、まとまりの下線に含まれます）。
              </div>
            </div>

            {/* 表示 */}
            <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">上：詳細 / 中：単語（下線） / 下：SVOCM（グループ）/ さらに下：訳</div>
                <div className="flex items-center gap-2">
                  <button
                    className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                    onClick={jumpCursorToSelected}
                    disabled={jaTargets.length === 0}
                    title="選択中の単語/まとまりが訳入力対象なら、訳カーソルをそこへ移動"
                  >
                    訳カーソルを選択へ
                  </button>
                  <button
                    className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                    onClick={clearSelection}
                    disabled={selectedIds.length === 0}
                    title="選択解除"
                  >
                    選択解除
                  </button>
                </div>
              </div>

              {currentDoc.tokens.length === 0 ? (
                <div className="text-sm text-gray-500">まだ分解されていません。「単語に分解（タグ付け開始）」を押してください。</div>
              ) : (
                <div ref={containerRef} className="flex flex-wrap gap-0 items-end relative">
                  {/* ★修正: 熟語の訳を絶対配置で表示（DOM計算に基づく） */}
                  {currentDoc.idioms.map((idm) => {
                      const pos = idiomPositions[idm.id];
                      if (!pos || !idm.ja) return null;
                      return (
                          <div
                              key={idm.id}
                              // ★修正：スタイルを通常の訳と揃えるため bg-white 等を削除、max-wを設定
                              className="absolute -translate-x-1/2 z-30 pointer-events-none w-max max-w-[240px] flex justify-center"
                              style={{ left: pos.left, top: pos.top }}
                          >
                               <div className="text-[10px] text-gray-500 text-center break-words leading-none">
                                   {idm.ja}
                               </div>
                          </div>
                      );
                  })}

                  {displayUnits.map((u, ui) => {
                    const roleText = roleShort(u.roleToShow);
                    const roleClass = classForRole(u.roleToShow === "NONE" ? "NONE" : u.roleToShow);

                    const unitHasUnderline = u.tokenIds.some((tid) => {
                      const tok = currentDoc.tokens[idToIndex.get(tid) ?? -1];
                      return tok ? shouldUnderlineToken(tok.text) : false;
                    });

                    // ★修正: DOM計測用にIDを付与
                    const unitId = u.tokenIds.length > 0 ? `unit-${u.tokenIds[0]}` : undefined;

                    return (
                      <div 
                        key={`${ui}-${u.tokenIds.join(",")}`} 
                        id={unitId}
                        className="flex flex-col items-center mx-[2px] relative"
                      >
                        <div
                          className={[
                            "inline-flex items-end pb-1",
                            unitHasUnderline ? "border-b border-gray-700" : "",
                          ].join(" ")}
                        >
                          {u.tokenIds.map((tid) => {
                            const idx = idToIndex.get(tid);
                            const token = idx !== undefined ? currentDoc.tokens[idx] : null;
                            if (!token || idx === undefined) return null;

                            const selected = selectedIds.includes(tid);
                            
                            // ★Detail Group Visualization
                            const dg = detailGroupByTokenId.get(tid);
                            const topDetailLabel = dg ? detailShort(dg.detail) : "";
                            
                            let isGroupStart = false;
                            let isGroupEnd = false;
                            
                            if (dg && dg.tokenIds.length > 1) {
                                const pos = dg.tokenIds.indexOf(tid);
                                isGroupStart = pos === 0;
                                isGroupEnd = pos === dg.tokenIds.length - 1;
                            }

                            // ブラケット風のボーダー
                            const topBorderStyle = dg && dg.tokenIds.length > 1 ? "border-gray-400 border-t" : "";
                            const leftBorderStyle = isGroupStart ? "border-gray-400 border-l rounded-tl" : "";
                            const rightBorderStyle = isGroupEnd ? "border-gray-400 border-r rounded-tr" : "";
                            
                            // ラベルはグループの先頭（シングルならその単語）にのみ表示
                            const showLabel = dg ? (dg.tokenIds.length > 1 ? isGroupStart : true) : false;

                            // ★Idiom Visualization (金色の枠)
                            const idm = idiomByTokenId.get(tid);
                            let isIdiomStart = false;
                            let isIdiomEnd = false;
                            let isIdiomMiddle = false;
                            let isIdiomSingle = false;

                            if (idm) {
                                const pos = idm.tokenIds.indexOf(tid);
                                if (idm.tokenIds.length === 1) {
                                    isIdiomSingle = true;
                                } else {
                                    if (pos === 0) isIdiomStart = true;
                                    else if (pos === idm.tokenIds.length - 1) isIdiomEnd = true;
                                    else isIdiomMiddle = true;
                                }
                            }
                            
                            // 熟語のスタイル（SVOCMや詳細タグと干渉しないよう絶対配置で重ねる）
                            const idiomStyle = (() => {
                                if (!idm) return null;
                                const base = "absolute inset-0 pointer-events-none border-yellow-500 box-border z-10";
                                if (isIdiomSingle) return `${base} border-2 rounded`;
                                if (isIdiomStart) return `${base} border-l-2 border-y-2 border-r-0 rounded-l`;
                                if (isIdiomEnd) return `${base} border-r-2 border-y-2 border-l-0 rounded-r`;
                                if (isIdiomMiddle) return `${base} border-y-2 border-x-0`;
                                return null;
                            })();

                            const opens = spanMarksByTokenId.starts.get(tid) ?? [];
                            const closes = spanMarksByTokenId.ends.get(tid) ?? [];

                            const fade =
                              !shouldUnderlineToken(token.text) && !isSpecialPunct(token.text)
                                ? "opacity-80"
                                : "";

                            return (
                              <div key={tid} className="flex flex-col items-center relative">
                                {/* 上部詳細タグエリア：ボーダーとラベル */}
                                <div className={`relative w-full h-[18px] flex items-end justify-center ${topBorderStyle} ${leftBorderStyle} ${rightBorderStyle} box-border`}>
                                   {showLabel && (
                                     <div className="absolute bottom-[2px] left-0 whitespace-nowrap text-[10px] text-gray-700 leading-none">
                                          {topDetailLabel}
                                     </div>
                                   )}
                                </div>

                                <div className="flex items-center gap-[0px] px-[1px]">
                                  {opens.map((item, i) => (
                                    <button
                                        key={`o-${tid}-${i}`}
                                        onClick={(e) => onSpanClick(item.span, e)}
                                        className={`text-xs select-none cursor-pointer ${item.span.id === selectedSpanId ? 'text-blue-600 font-bold' : 'text-gray-700 hover:text-blue-500'}`}
                                        title="クリックでこの範囲を選択（品詞付与可）"
                                    >
                                      {item.char}
                                    </button>
                                  ))}

                                  {/* トークンボタン本体（相対配置にし、熟語枠を絶対配置で重ねる） */}
                                  <div className="relative">
                                    {idiomStyle && <div className={idiomStyle} />}
                                    <button
                                      onClick={(ev) => onTokenClick(idx, tid, ev)}
                                      className={[
                                        "rounded-xl border px-2 py-1 transition mx-[1px]",
                                        roleClass,
                                        selected ? "ring-2 ring-black/15" : "hover:bg-gray-50",
                                        fade,
                                      ].join(" ")}
                                      title="クリックで選択（Shiftで範囲）"
                                    >
                                      <div className="text-sm leading-none">{token.text}</div>
                                    </button>
                                  </div>

                                  {closes.map((item, i) => (
                                    <button
                                        key={`c-${tid}-${i}`}
                                        onClick={(e) => onSpanClick(item.span, e)}
                                        className={`text-xs select-none cursor-pointer ${item.span.id === selectedSpanId ? 'text-blue-600 font-bold' : 'text-gray-700 hover:text-blue-500'}`}
                                        title="クリックでこの範囲を選択（品詞付与可）"
                                    >
                                      {item.char}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-1 text-[10px] text-gray-600 min-h-[12px] leading-none">{roleText}</div>

                        {/* ★修正: 熟語に含まれる場合は通常の訳（グループ訳など）を表示せず、高さ確保のみ行う */}
                        <div className="mt-0.5 text-[10px] text-gray-500 min-h-[12px] max-w-[240px] text-center break-words">
                          {(() => {
                             // このユニットのどれか一つでも熟語に含まれていれば、通常の訳は非表示（熟語訳に任せる）
                             const isIncludedInIdiom = u.tokenIds.some(tid => idiomByTokenId.has(tid));
                             if (isIncludedInIdiom) {
                                 // 高さを確保するための空文字（invisible）
                                 return <span className="invisible">.</span>;
                             }

                             // 通常時
                             return u.groupId && (u.groupJa ?? "").trim()
                               ? (u.groupJa ?? "").trim()
                               : !u.groupId && (u.tokenJa ?? "").trim()
                               ? (u.tokenJa ?? "").trim()
                               : "";
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 1) 上の詳細タグ パネル */}
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
                      {selectedSpanId
                        ? "【括弧（節/句）を選択中】この状態でタグを押すと括弧に品詞がつきます。"
                        : selectedDetailState === "MIXED"
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
                        className={`rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 ${selectedSpanId ? 'ring-2 ring-blue-100 border-blue-300' : ''}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="text-xs text-gray-500">
                    ※複数選択してタグを押すと、それらを1つのまとまりとしてタグ付けします（例：a few → 1つの(形)）。
                  </div>
                </div>
              )}
            </div>

            {/* 2) 下（SVOCM）パネル */}
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
                    ※グループ化は基本「単語」だけ。複数選択のときだけ「,」「.」「&quot;」もグループに含められます（ただし記号だけのグループは作りません）。
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

            {/* 3) 括弧パネル */}
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
                    <div className="text-xs text-gray-500">※括弧は「交差（クロス）」する形だけ自動で解消します（ネストはOK）。</div>
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

                  <div className="text-xs text-gray-500">※飛び飛び選択は、最小〜最大の連続範囲に自動補正して括弧を付けます。</div>
                </div>
              )}
            </div>

            {/* ★追加 4) 熟語パネル */}
            <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
              <div className="text-sm font-medium">熟語（イディオム）を設定 {roleHintText}</div>
              
              {selectedTokens.length === 0 ? (
                  <div className="text-sm text-gray-500">上の単語を複数選択してください。</div>
              ) : (
                  <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm">
                          選択: <span className="font-semibold">{selectedText}</span>
                        </div>
                        <div className="text-xs text-gray-500">
                            {selectedIdiom ? "現在: 熟語設定済み" : "現在: 熟語設定なし"}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                          <button
                            onClick={setIdiomToSelected}
                            className="rounded-xl border px-3 py-2 text-sm hover:bg-yellow-50 border-yellow-400 text-yellow-800"
                            title="選択範囲を金色の線で囲みます"
                          >
                            選択範囲を熟語にする（金色の囲み）
                          </button>
                          
                          <button
                            onClick={clearIdiomFromSelected}
                            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                            title="選択範囲の熟語設定を解除"
                            disabled={!selectedIdiom}
                          >
                            熟語解除
                          </button>
                      </div>
                      <div className="text-xs text-gray-500">
                          ※SVOCMの下線とは別に、金色の枠線で囲まれます。熟語単位で日本語訳を入力できるようになります。
                      </div>
                  </div>
              )}
            </div>

            {/* 5) 日本語訳（矢印で切り替え：1つだけ表示） */}
            <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">日本語訳（矢印キーで次/前へ）</div>
                <div className="flex items-center gap-2">
                  <button
                    className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                    onClick={() => moveJaCursor(-1)}
                    disabled={jaTargets.length === 0}
                    title="前（↑/← でも可）"
                  >
                    ← 前
                  </button>
                  <button
                    className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50"
                    onClick={() => moveJaCursor(+1)}
                    disabled={jaTargets.length === 0}
                    title="次（↓/→ でも可）"
                  >
                    次 →
                  </button>
                </div>
              </div>

              {jaTargets.length === 0 ? (
                <div className="text-sm text-gray-500">訳入力の対象がありません。単語が分解されているか確認してください。</div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs text-gray-600">
                    {jaCursor + 1} / {jaTargets.length}{" "}
                    {currentJaTarget?.kind === "group" ? (
                      <span className="ml-2">
                        role: <span className="font-semibold">{currentJaTarget.role}</span>
                      </span>
                    ) : currentJaTarget?.kind === "idiom" ? (
                      <span className="ml-2 text-yellow-600 font-semibold">
                        （熟語）
                      </span>
                    ) : (
                      <span className="ml-2 text-gray-500">（単語）</span>
                    )}
                  </div>

                  <div className="rounded-xl border p-3 bg-gray-50">
                    <div className="text-sm">
                      対象: <span className="font-semibold">{currentJaTarget?.text ?? ""}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">
                      入力欄で ↑/↓/←/→ を押すと、次の入力欄へ切り替わります（場所を取りません）。
                    </div>
                  </div>

                  <textarea
                    ref={jaInputRef}
                    className="w-full min-h-[72px] rounded-xl border p-3 text-sm outline-none focus:ring-2 focus:ring-gray-200"
                    placeholder="ここに日本語訳を入力（短くてOK）"
                    value={currentJaTarget?.ja ?? ""}
                    onChange={(e) => onUpdateJaTarget(e.target.value)}
                    onKeyDown={onJaKeyDown}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}