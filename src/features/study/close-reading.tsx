// src/features/study/close-reading.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
// ★追加：自（自動詞）, 他（他動詞）
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
  | "自"
  | "他"
  | "NONE";

// 句/従属節の括弧（表示だけで、tokens順は絶対に動かさない）
type SpanKind = "PHRASE" | "CLAUSE"; // PHRASE=( ) / CLAUSE=[ ]

type Token = {
  id: string;
  text: string;
  role?: Role; // v1互換のため残す（v2以降は group が主役）
  detail?: Detail; // 単語の上に出す詳細タグ
  ja?: string; // ★追加：単語（and等、グループ化しないもの）にも訳を持てる
};

type Group = {
  id: string;
  tokenIds: string[]; // tokens順に正規化して保存
  role: Role; // 下線の下に出す SVOCM 等（グループで1つだけ表示）
  ja?: string; // ★グループの日本語訳
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
  spans: Span[];
  updatedAt: number;
};

type StoreV5 = {
  version: 5;
  inputText: string;
  tokens: Token[];
  groups: Group[];
  spans: Span[];
  updatedAt: number;
};

type StoreV6 = {
  version: 6;
  inputText: string;
  tokens: Token[]; // token.ja を持つ
  groups: Group[];
  spans: Span[];
  updatedAt: number;
};

type Doc = StoreV6;

// ★フォルダ/ファイル構造（If-Then と同じ骨格）
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
  { detail: "自", label: "自（自動詞）" }, // ★追加
  { detail: "他", label: "他（他動詞）" }, // ★追加（既存の「他」は他動詞として扱う）
  { detail: "前", label: "前（前置詞）" },
  { detail: "冠", label: "冠（冠詞）" },
  { detail: "助", label: "助（助動詞）" },
  { detail: "接", label: "接（接続詞）" },
  { detail: "等", label: "等（等位・並列）" },
  { detail: "NONE", label: "未設定" },
];

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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
    ja: "",
  }));
}

function defaultDocV6(): StoreV6 {
  return {
    version: 6,
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

/** 下線を引きたいトークンか（, . などは false） */
function shouldUnderlineToken(t: string) {
  if (isWordToken(t)) return true;
  // よくある句読点は下線なし
  if (/^[,\.!?;:]+$/.test(t)) return false;
  // その他記号も基本は下線なし
  return false;
}

/** 訳入力の対象か（, . は対象外） */
function isJaTargetToken(t: string) {
  return shouldUnderlineToken(t);
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

// ---- 型ガード（unknown[] → string[] を確実にする）----
function isString(x: unknown): x is string {
  return typeof x === "string";
}
function uniqueStringsPreserveOrder(xs: string[]) {
  return Array.from(new Set(xs));
}

/** v1-v6 を v6 に吸収（ドキュメント単体） */
function migrateDoc(raw: any): StoreV6 {
  const base = defaultDocV6();
  if (!raw || typeof raw !== "object") return base;

  const normalizeTokens = (tokensIn: any[]): Token[] =>
    (Array.isArray(tokensIn) ? tokensIn : [])
      .map((x: any) => {
        if (!x || typeof x !== "object") return null;
        const text = typeof x.text === "string" ? x.text : null;
        if (!text) return null;
        const role = typeof x.role === "string" ? (x.role as Role) : "NONE";
        const detail = typeof x.detail === "string" ? (x.detail as Detail) : "NONE";
        const ja = typeof x.ja === "string" ? x.ja : "";
        return {
          id: typeof x.id === "string" ? x.id : newId(),
          text,
          role,
          detail,
          ja,
        } satisfies Token;
      })
      .filter(Boolean) as Token[];

  const normalizeGroups = (groupsIn: any[], tokenSet: Set<string>, idToIndex: Map<string, number>): Group[] =>
    (Array.isArray(groupsIn) ? groupsIn : [])
      .map((g: any) => {
        if (!g || typeof g !== "object") return null;

        const role = typeof g.role === "string" ? (g.role as Role) : "NONE";

        // ★ここで必ず string[] にする（unknown[] にならない）
        const tokenIdsRaw: string[] = Array.isArray(g.tokenIds)
          ? (g.tokenIds as unknown[])
              .filter(isString)
              .filter((id) => tokenSet.has(id))
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

  const normalizeSpans = (spansIn: any[], tokenSet: Set<string>, idToIndex: Map<string, number>): Span[] =>
    (Array.isArray(spansIn) ? spansIn : [])
      .map((s: any) => {
        if (!s || typeof s !== "object") return null;
        const kind = s.kind === "CLAUSE" || s.kind === "PHRASE" ? (s.kind as SpanKind) : null;
        if (!kind) return null;

        // ★ここが今回の原因：Set の入力を string[] にしてから uniq
        const tokenIdsRaw: string[] = Array.isArray(s.tokenIds)
          ? uniqueStringsPreserveOrder((s.tokenIds as unknown[]).filter(isString)).filter((id) => tokenSet.has(id))
          : [];

        if (tokenIdsRaw.length === 0) return null;

        return {
          id: typeof s.id === "string" ? s.id : newId(),
          kind,
          tokenIds: normalizeTokenIds(tokenIdsRaw, idToIndex),
        } satisfies Span;
      })
      .filter(Boolean) as Span[];

  // v6
  if (raw.version === 6) {
    const inputText = typeof raw.inputText === "string" ? raw.inputText : "";
    const tokens = normalizeTokens(raw.tokens);
    const idToIndex = new Map(tokens.map((t, i) => [t.id, i]));
    const tokenSet = new Set(tokens.map((t) => t.id));
    const groups = normalizeGroups(raw.groups, tokenSet, idToIndex);
    const spans = normalizeSpans(raw.spans, tokenSet, idToIndex);
    const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now();
    return { version: 6, inputText, tokens, groups, spans, updatedAt };
  }

  // v5/v4/v3/v2
  if (raw.version === 5 || raw.version === 4 || raw.version === 3 || raw.version === 2) {
    const inputText = typeof raw.inputText === "string" ? raw.inputText : "";
    const tokens = normalizeTokens(raw.tokens);
    const idToIndex = new Map(tokens.map((t, i) => [t.id, i]));
    const tokenSet = new Set(tokens.map((t) => t.id));
    const groups = normalizeGroups(raw.groups, tokenSet, idToIndex);
    const spans = normalizeSpans(raw.spans, tokenSet, idToIndex);
    const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now();
    return { version: 6, inputText, tokens, groups, spans, updatedAt };
  }

  // v1
  if (raw.version === 1) {
    const v1 = raw as StoreV1;
    const inputText = typeof v1.inputText === "string" ? v1.inputText : "";
    const tokens0: Token[] = Array.isArray(v1.tokens)
      ? (v1.tokens
          .map((x: any) => {
            if (!x || typeof x !== "object") return null;
            const text = typeof x.text === "string" ? x.text : null;
            if (!text) return null;
            const role = typeof x.role === "string" ? (x.role as Role) : "NONE";
            return {
              id: typeof x.id === "string" ? x.id : newId(),
              text,
              role,
              detail: "NONE",
              ja: "",
            } as Token;
          })
          .filter(Boolean) as Token[])
      : [];
    const idToIndex0 = new Map(tokens0.map((t, i) => [t.id, i]));

    // role を group 化
    const groups0: Group[] = [];
    for (const t of tokens0) {
      const r = (t.role ?? "NONE") as Role;
      if (r !== "NONE") groups0.push({ id: newId(), tokenIds: [t.id], role: r, ja: "" });
      t.role = "NONE";
    }
    const groups = groups0.map((g) => ({ ...g, tokenIds: normalizeTokenIds(g.tokenIds, idToIndex0) }));

    const updatedAt = typeof v1.updatedAt === "number" ? v1.updatedAt : Date.now();
    return { version: 6, inputText, tokens: tokens0, groups, spans: [], updatedAt };
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

  // 新フォーマット
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

    // nodesが空ならデフォルト
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
    const currentFileId = raw.currentFileId === null || typeof raw.currentFileId === "string" ? raw.currentFileId : null;

    // current が壊れてたら補正
    const safeFolderId =
      currentFolderId && nodes2[currentFolderId]?.kind === "folder" ? currentFolderId : def.currentFolderId;
    const safeFileId =
      currentFileId && nodes2[currentFileId]?.kind === "file" && files[currentFileId] ? currentFileId : null;

    return {
      version: 1,
      nodes: nodes2,
      files,
      currentFolderId: safeFolderId,
      currentFileId: safeFileId,
    };
  }

  // 旧フォーマット（ドキュメント単体 v1~v6）→ 新フォーマットへ変換
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

/** 表示用：トークン配列から文字列（スペース調整） */
function joinTokensForDisplay(tokens: string[]) {
  // ざっくり：句読点の前にはスペースを入れない
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

  // 左ツリー：作成
  const [newFolderName, setNewFolderName] = useState("");
  const [newFileName, setNewFileName] = useState("");

  const nodes = store.nodes;
  const currentFolderId = store.currentFolderId;
  const currentFileId = store.currentFileId;

  const currentDoc: Doc | null = currentFileId ? store.files[currentFileId] ?? null : null;
  const currentFileName = currentFileId ? nodes[currentFileId]?.name ?? "" : "";

  // ----------------- UI states (doc-local) -----------------
  // 選択（ID）
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Shift用アンカー
  const anchorIndexRef = useRef<number | null>(null);

  // 訳入力：矢印で「次/前」の対象を切り替える
  const [jaCursor, setJaCursor] = useState(0);
  const jaInputRef = useRef<HTMLTextAreaElement | null>(null);

  // 現在ファイルが変わったら選択などをリセット
  useEffect(() => {
    setSelectedIds([]);
    anchorIndexRef.current = null;
    setJaCursor(0);
  }, [currentFileId]);

  // Store change => localStorage
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // 手動同期購読（ホームの📥/☁のみ）
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

  // ----------------- Tree UI derived -----------------
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

  // ----------------- Tree ops -----------------
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
      const doc: Doc = defaultDocV6();
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

  // ----------------- Current doc updater -----------------
  const updateCurrentDoc = (updater: (prev: Doc) => Doc) => {
    if (!currentFileId) return;
    setStore((s) => {
      const cur = s.files[currentFileId];
      if (!cur) return s;
      const next = updater(cur);
      return { ...s, files: { ...s.files, [currentFileId]: next } };
    });
  };

  // tokens順の index map（順番固定の要）
  const idToIndex = useMemo(
    () => new Map((currentDoc?.tokens ?? []).map((t, i) => [t.id, i])),
    [currentDoc?.tokens]
  );

  // tokenId -> group
  const groupByTokenId = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of currentDoc?.groups ?? []) for (const tid of g.tokenIds) m.set(tid, g);
    return m;
  }, [currentDoc?.groups]);

  const selectedTokens = useMemo(() => {
    const set = new Set(selectedIds);
    return (currentDoc?.tokens ?? []).filter((t) => set.has(t.id));
  }, [currentDoc?.tokens, selectedIds]);

  const selectedText = useMemo(() => joinTokensForDisplay(selectedTokens.map((t) => t.text)), [selectedTokens]);

  const selectedGroup = useMemo(() => {
    if (!currentDoc) return null;
    if (selectedIds.length === 0) return null;
    const groupIds = uniq(selectedIds.map((id) => groupByTokenId.get(id)?.id ?? "").filter((x) => x));
    if (groupIds.length !== 1) return null;
    return currentDoc.groups.find((g) => g.id === groupIds[0]) ?? null;
  }, [currentDoc, selectedIds, groupByTokenId]);

  const selectedDetailState = useMemo(() => {
    if (selectedTokens.length === 0) return "";
    const details = uniq(selectedTokens.map((t) => (t.detail ?? "NONE") as string));
    if (details.length === 1) return details[0] === "NONE" ? "NONE" : details[0];
    return "MIXED";
  }, [selectedTokens]);

  // 入力文からトークン生成
  const onBuild = () => {
    if (!currentDoc) return;
    const tokens = tokenize(currentDoc.inputText);
    updateCurrentDoc((prev) => ({
      ...prev,
      version: 6,
      tokens,
      groups: [],
      spans: [],
      updatedAt: Date.now(),
    }));
    setSelectedIds([]);
    anchorIndexRef.current = null;
    setJaCursor(0);
  };

  const onClearSVOCM = () => {
    if (!currentDoc) return;
    // グループを消す（訳も消える）。単語訳（token.ja）は残す
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
    anchorIndexRef.current = null;
  };

  // クリック選択（Shiftは範囲で置き換え）
  const onTokenClick = (index: number, id: string, ev: React.MouseEvent) => {
    const isShift = ev.shiftKey;
    const isMeta = ev.metaKey || ev.ctrlKey;

    if (!currentDoc) return;

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

  /** グループ化/下線対象から , . などを除外する */
  const filterUnderlineEligibleIds = (ids: string[], tokens: Token[]) => {
    const map = new Map(tokens.map((t) => [t.id, t] as const));
    return ids.filter((id) => {
      const t = map.get(id);
      if (!t) return false;
      return shouldUnderlineToken(t.text);
    });
  };

  // role付与（飛び飛びは連続範囲に補正）
  const setRoleToSelected = (role: Role) => {
    if (!currentDoc) return;
    if (selectedIds.length === 0) return;

    // 連続範囲へ補正 → 下線対象だけ残す（, . は消える）
    const coerced0 = coerceToContiguousSelection(selectedIds, idToIndex, currentDoc.tokens);
    const coerced = filterUnderlineEligibleIds(coerced0, currentDoc.tokens);
    if (coerced.length === 0) return;

    const selectedSet = new Set(coerced);

    // 既存グループと完全一致なら role だけ更新
    if (selectedGroup) {
      const gSet = new Set(selectedGroup.tokenIds);
      const same = selectedGroup.tokenIds.length === coerced.length && coerced.every((x) => gSet.has(x));
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

      // 1) 選択tokenを既存グループから除去（空なら削除）
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

      // 2) 新グループ作成（日本語訳は空で開始）
      nextGroups.push({
        id: newId(),
        tokenIds: normalizeTokenIds(coerced, idToIndex2),
        role,
        ja: "",
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
    if (!currentDoc) return;
    if (selectedIds.length === 0) return;

    const coerced = coerceToContiguousSelection(selectedIds, idToIndex, currentDoc.tokens);
    const set = new Set(coerced);

    updateCurrentDoc((prev) => ({
      ...prev,
      tokens: prev.tokens.map((t) => (set.has(t.id) ? { ...t, detail } : t)),
      updatedAt: Date.now(),
    }));

    setSelectedIds(coerced);
  };

  // 括弧（句/従属節）付与：交差する括弧は自動で解消
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
          kind: s.kind === "CLAUSE" || s.kind === "PHRASE" ? s.kind : "PHRASE",
          tokenIds: normalizeTokenIds(
            (Array.isArray(s.tokenIds) ? (s.tokenIds as unknown[]).filter(isString) : []).filter((id) => tokenSet.has(id)),
            idToIndex2
          ),
        };
        if (s2.tokenIds.length === 0) continue;

        const r = spanRange(s2, idToIndex2);

        // 完全一致なら置き換え
        if (s2.kind === kind && r.start === newR.start && r.end === newR.end) continue;

        // 交差（クロス）するものは削除（ネストはOK）
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
        if (la !== lb) return lb - la; // 外側を先
        if (a.kind !== b.kind) return a.kind === "CLAUSE" ? -1 : 1;
        return a.id.localeCompare(b.id);
      });

      return { ...prev, spans: kept, updatedAt: Date.now() };
    });

    setSelectedIds(coerced);
  };

  // 括弧を外す：選択範囲に被る span を削除
  const removeSpansOverlappingSelection = () => {
    if (!currentDoc) return;
    if (selectedIds.length === 0) return;
    const coerced = coerceToContiguousSelection(selectedIds, idToIndex, currentDoc.tokens);

    updateCurrentDoc((prev) => {
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

  // ★日本語訳（グループ）更新
  const setJaToGroup = (groupId: string, ja: string) => {
    if (!currentDoc) return;
    updateCurrentDoc((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === groupId ? { ...g, ja } : g)),
      updatedAt: Date.now(),
    }));
  };

  // ★日本語訳（単語）更新
  const setJaToToken = (tokenId: string, ja: string) => {
    if (!currentDoc) return;
    updateCurrentDoc((prev) => ({
      ...prev,
      tokens: prev.tokens.map((t) => (t.id === tokenId ? { ...t, ja } : t)),
      updatedAt: Date.now(),
    }));
  };

  const autoHint = () => {
    if (!currentDoc) return;

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

    updateCurrentDoc((prev) => {
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
        nextGroups.push({ id: newId(), tokenIds: [t.id], role: "V", ja: "" });
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

    for (const t of doc.tokens) {
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

      const ordered = normalizeTokenIds(g.tokenIds, idToIndex);
      units.push({
        tokenIds: ordered,
        roleToShow: g.role,
        groupId: g.id,
        groupJa: typeof g.ja === "string" ? g.ja : "",
        tokenJa: "",
      });
    }

    return units;
  }, [currentDoc, idToIndex]);

  // 括弧の開始/終了マーカー（ネスト対応：外側→内側の順）
  const spanMarksByTokenId = useMemo(() => {
    const doc = currentDoc;
    const starts = new Map<string, string[]>();
    const ends = new Map<string, string[]>();
    if (!doc) return { starts, ends };

    const spans = doc.spans ?? [];
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
  }, [currentDoc, idToIndex]);

  /** 右パネルの「訳入力対象」：グループ or 単語（and等） */
  type JaTarget =
    | { kind: "group"; id: string; role: Role; tokenIds: string[]; text: string; ja: string }
    | { kind: "token"; id: string; tokenId: string; text: string; ja: string };

  const jaTargets = useMemo<JaTarget[]>(() => {
    const doc = currentDoc;
    if (!doc) return [];

    const targets: JaTarget[] = [];
    for (const u of displayUnits) {
      if (u.groupId) {
        const words = u.tokenIds
          .map((id) => doc.tokens[idToIndex.get(id) ?? -1]?.text)
          .filter((x): x is string => typeof x === "string");
        const visible = words.filter((t) => isJaTargetToken(t));
        if (visible.length === 0) continue;

        targets.push({
          kind: "group",
          id: `g:${u.groupId}`,
          role: u.roleToShow,
          tokenIds: u.tokenIds,
          text: joinTokensForDisplay(words),
          ja: (u.groupJa ?? "").trim(),
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
        });
      }
    }
    return targets;
  }, [currentDoc, displayUnits, idToIndex]);

  // ターゲット数が変わったらカーソルを丸める
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
    if (currentJaTarget.kind === "group") setJaToGroup(currentJaTarget.id.slice(2), value); // "g:" を外す
    else setJaToToken(currentJaTarget.tokenId, value);
  };

  // 現在の選択が「訳カーソルの対象」に一致するなら、その対象へジャンプ
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
      }
    }
  };

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

          <div className="text-[11px] text-gray-500 leading-relaxed">
            localStorage即時保存 / サーバ同期はホームの📥/☁のみ
          </div>
        </div>
      </section>

      {/* Right */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[200px]">
        {!currentDoc ? (
          <p className="text-sm text-gray-500">
            左のフォルダからノート（ファイル）を選択するか、新しいノートを作成してください。
          </p>
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
                placeholder="例: Every living thing exists (in a particular place), and that place has certain conditions."
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
                ※ , や . などの句読点には「下線」を引きません（グループ化もされません）。
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
                <div className="flex flex-wrap gap-3 items-end">
                  {displayUnits.map((u, ui) => {
                    const roleText = roleShort(u.roleToShow);
                    const roleClass = classForRole(u.roleToShow === "NONE" ? "NONE" : u.roleToShow);

                    const jaText =
                      u.groupId && (u.groupJa ?? "").trim()
                        ? (u.groupJa ?? "").trim()
                        : !u.groupId && (u.tokenJa ?? "").trim()
                        ? (u.tokenJa ?? "").trim()
                        : "";

                    // ★「下線復活」：このユニット内に下線対象が1つでもある場合だけ、ユニット全体に下線を引く
                    const unitHasUnderline = u.tokenIds.some((tid) => {
                      const tok = currentDoc.tokens[idToIndex.get(tid) ?? -1];
                      return tok ? shouldUnderlineToken(tok.text) : false;
                    });

                    return (
                      <div key={`${ui}-${u.tokenIds.join(",")}`} className="flex flex-col items-center">
                        {/* ★まとまり下線（句読点ユニットには出ない） */}
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
                            const top = detailShort((token.detail ?? "NONE") as Detail);

                            const opens = spanMarksByTokenId.starts.get(tid) ?? [];
                            const closes = spanMarksByTokenId.ends.get(tid) ?? [];

                            return (
                              <div key={tid} className="flex flex-col items-center mx-[2px]">
                                {/* 上：詳細タグ */}
                                <div className="text-[10px] text-gray-700 min-h-[12px] leading-none">{top}</div>

                                {/* 中：括弧 + 単語 + 括弧 */}
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

                        {/* さらに下：訳（グループ or 単語） */}
                        <div className="mt-0.5 text-[10px] text-gray-500 min-h-[12px] max-w-[240px] text-center break-words">
                          {jaText ? jaText : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ============================
               ここから：依頼どおりの順番に並び替え
               1) 上の詳細タグ
               2) 下線の下（SVOCM）
               3) 括弧
               4) 日本語訳
               ============================ */}

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
                    ※グループ化するとき、句読点（, . など）は自動で除外されます（下線も引きません）。
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

            {/* 4) 日本語訳（矢印で切り替え：1つだけ表示） */}
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
                <div className="text-sm text-gray-500">
                  訳入力の対象がありません。単語が分解されているか確認してください。（, . は対象外）
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs text-gray-600">
                    {jaCursor + 1} / {jaTargets.length}{" "}
                    {currentJaTarget?.kind === "group" ? (
                      <span className="ml-2">
                        role: <span className="font-semibold">{currentJaTarget.role}</span>
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
