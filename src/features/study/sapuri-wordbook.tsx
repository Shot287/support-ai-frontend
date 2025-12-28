// src/features/study/sapuri-wordbook.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";

type ID = string;

type NoteKind = "other" | "intransitive" | "uncountable";

type WordItem = {
  id: ID;
  no: number; // スタディサプリの番号（1〜100 など）
  pos: string; // 品詞（例: "名", "動", "副" など）
  word: string; // 英単語
  meaning: string; // 日本語の意味（JSONインポート由来）
  myMeaning: string; // 自分なりの和訳（追記エリア）

  // ★ 追加：Part5対策メモ
  noteKind: NoteKind; // 自動詞 / 不可算名詞 / その他
  intransPrep: string; // 自動詞なら後ろに続く前置詞（例: "to", "for", "with" ...）

  marked: boolean; // マーク対象かどうか
  struck: boolean; // 取り消し線（英単語に線を引く）
};

type Folder = {
  id: ID;
  name: string;
  words: WordItem[];
};

type Store = {
  folders: Folder[];
  currentFolderId: ID | null;
  version: 1;
};

const LOCAL_KEY = "study_sapuri_words_v1";
const DOC_KEY = "study_sapuri_words_v1";

// ★ 自動学習の解答表示待ち（ms）を保存するキー
const AUTO_DELAY_LOCAL_KEY = "study_sapuri_words_auto_delay_ms_v1";
// ★ スライダーの範囲（ms）
const AUTO_DELAY_MIN = 300;
const AUTO_DELAY_MAX = 3000;
const AUTO_DELAY_STEP = 100;
const AUTO_DELAY_DEFAULT = 1000;

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function createDefaultStore(): Store {
  return {
    folders: [],
    currentFolderId: null,
    version: 1,
  };
}

function normalizeNoteKind(v: any): NoteKind {
  if (v === "intransitive" || v === "uncountable" || v === "other") return v;
  return "other";
}

function loadLocal(): Store {
  try {
    if (typeof window === "undefined") return createDefaultStore();
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createDefaultStore();
    const parsed = JSON.parse(raw) as any;

    if (!parsed || typeof parsed !== "object") return createDefaultStore();

    const def = createDefaultStore();

    const folders: Folder[] = Array.isArray(parsed.folders)
      ? parsed.folders.map((f: any): Folder => {
          const wordsArray: any[] = Array.isArray(f.words) ? f.words : [];
          const words: WordItem[] = wordsArray.map((w: any): WordItem => ({
            id: typeof w.id === "string" ? w.id : uid(),
            no: typeof w.no === "number" ? w.no : 0,
            pos: typeof w.pos === "string" ? w.pos : "",
            word: String(w.word ?? ""),
            meaning: String(w.meaning ?? ""),
            myMeaning:
              typeof w.myMeaning === "string" ? w.myMeaning : String(w.myMeaning ?? ""),

            noteKind: normalizeNoteKind(w.noteKind),
            intransPrep: typeof w.intransPrep === "string" ? w.intransPrep : String(w.intransPrep ?? ""),

            marked: Boolean(w.marked),
            struck: Boolean(w.struck),
          }));
          return {
            id: typeof f.id === "string" ? f.id : uid(),
            name: typeof f.name === "string" ? f.name : "未設定フォルダ",
            words,
          };
        })
      : def.folders;

    return {
      folders,
      currentFolderId: typeof parsed.currentFolderId === "string" ? parsed.currentFolderId : def.currentFolderId,
      version: 1,
    };
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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function loadAutoDelayMs(): number {
  try {
    if (typeof window === "undefined") return AUTO_DELAY_DEFAULT;
    const raw = localStorage.getItem(AUTO_DELAY_LOCAL_KEY);
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return AUTO_DELAY_DEFAULT;
    return clamp(Math.round(n), AUTO_DELAY_MIN, AUTO_DELAY_MAX);
  } catch {
    return AUTO_DELAY_DEFAULT;
  }
}

function saveAutoDelayMs(ms: number) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(AUTO_DELAY_LOCAL_KEY, String(ms));
  } catch {
    // noop
  }
}

// ===== 学習セッション用型 =====
type StudyMode = "all" | "marked";

type StudySession = {
  folderId: ID;
  mode: StudyMode;
  auto: boolean; // ★ 自動学習モード
  wordIds: ID[];
  currentIndex: number;
  showAnswer: boolean;
  correctCount: number;
  wrongCount: number;
  finished: boolean;
};

export default function SapuriWordbook() {
  const [store, setStore] = useState<Store>(() => loadLocal());
  const storeRef = useRef(store);

  // フォルダ作成用
  const [newFolderName, setNewFolderName] = useState("");
  // JSONインポート用
  const [jsonText, setJsonText] = useState("");

  // 学習セッション
  const [session, setSession] = useState<StudySession | null>(null);

  // ★ 自動学習の解答表示待ち時間（ms）
  const [autoDelayMs, setAutoDelayMs] = useState<number>(() => loadAutoDelayMs());

  // ★ 単語一覧UI
  const [showWordList, setShowWordList] = useState(true);
  const [listQuery, setListQuery] = useState("");
  const [listFilter, setListFilter] = useState<"all" | "marked" | "struck">("all");

  // ★ 音声（TTS）
  const [speakingWordId, setSpeakingWordId] = useState<ID | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // ★ 自動学習：二重発火防止 & タイマー管理
  const lastAutoWordIdRef = useRef<ID | null>(null);
  const autoTimerRef = useRef<number | null>(null);

  const clearAutoTimer = () => {
    if (typeof window === "undefined") return;
    if (autoTimerRef.current != null) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  };

  // ---- Store 変更時：localStorage に即保存（サーバ同期は manual-sync 任せ） ----
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // ---- 自動待ち時間：変更時に保存 ----
  useEffect(() => {
    const ms = clamp(Math.round(autoDelayMs), AUTO_DELAY_MIN, AUTO_DELAY_MAX);
    if (ms !== autoDelayMs) {
      setAutoDelayMs(ms);
      return;
    }
    saveAutoDelayMs(ms);
  }, [autoDelayMs]);

  // ---- 手動同期への登録 ----
  useEffect(() => {
    const unsubscribe = registerManualSync({
      pull: async () => {
        try {
          const remote = await loadUserDoc<Store>(DOC_KEY);
          if (remote && remote.version === 1) {
            const fixed: Store = {
              ...remote,
              folders: remote.folders.map((f) => ({
                ...f,
                words: f.words.map((w: any) => {
                  const nk = normalizeNoteKind(w.noteKind);
                  return {
                    ...w,
                    pos: typeof w.pos === "string" ? w.pos : "",
                    struck: Boolean(w.struck),
                    myMeaning: typeof w.myMeaning === "string" ? w.myMeaning : String(w.myMeaning ?? ""),
                    noteKind: nk,
                    intransPrep: typeof w.intransPrep === "string" ? w.intransPrep : String(w.intransPrep ?? ""),
                    // 自動詞じゃないなら、念のため前置詞は保持しつつ表示側で制御
                  };
                }),
              })),
            };
            setStore(fixed);
            saveLocal(fixed);
          }
        } catch (e) {
          console.warn("[sapuri-wordbook] manual PULL failed:", e);
        }
      },
      push: async () => {
        try {
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        } catch (e) {
          console.warn("[sapuri-wordbook] manual PUSH failed:", e);
        }
      },
      reset: async () => {
        /* no-op */
      },
    });

    return unsubscribe;
  }, []);

  // ---- 音声（TTS）初期化 ----
  useEffect(() => {
    if (typeof window === "undefined") return;

    const synth = window.speechSynthesis;
    if (!synth) {
      console.warn("[sapuri-wordbook] speechSynthesis is not supported.");
      return;
    }

    const loadVoices = () => {
      try {
        voicesRef.current = synth.getVoices() || [];
      } catch {
        voicesRef.current = [];
      }
    };

    loadVoices();
    synth.onvoiceschanged = () => loadVoices();

    return () => {
      try {
        synth.cancel();
      } catch {
        // noop
      }
    };
  }, []);

  const stopSpeak = () => {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;

    try {
      synth.cancel();
    } catch {
      // noop
    }
    utterRef.current = null;
    setSpeakingWordId(null);
  };

  const pickEnglishVoice = (voices: SpeechSynthesisVoice[]) => {
    const prefers = ["en-US", "en-GB", "en"];
    for (const lang of prefers) {
      const v = voices.find((x) => (x.lang || "").toLowerCase() === lang.toLowerCase());
      if (v) return v;
    }
    const v2 = voices.find((x) => (x.lang || "").toLowerCase().startsWith("en"));
    return v2 ?? null;
  };

  // ★ 通常の「押したら読む」用（既存）
  const speakWord = (wordId: ID, text: string) => {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) {
      alert("このブラウザでは音声読み上げに対応していません。");
      return;
    }

    const clean = String(text ?? "").trim();
    if (!clean) return;

    // 同じ単語が再生中なら停止
    if (speakingWordId === wordId && synth.speaking) {
      stopSpeak();
      return;
    }

    // 既存再生を止めてから新規
    try {
      synth.cancel();
    } catch {
      // noop
    }

    const u = new SpeechSynthesisUtterance(clean);
    utterRef.current = u;

    u.lang = "en-US";
    u.rate = 0.95;
    u.pitch = 1.0;
    u.volume = 1.0;

    const voices = voicesRef.current || [];
    const voice = pickEnglishVoice(voices);
    if (voice) {
      u.voice = voice;
      if (voice.lang) u.lang = voice.lang;
    }

    u.onend = () => {
      setSpeakingWordId((prev) => (prev === wordId ? null : prev));
      utterRef.current = null;
    };
    u.onerror = (e) => {
      console.warn("[sapuri-wordbook] speech error:", e);
      setSpeakingWordId(null);
      utterRef.current = null;
      try {
        synth.cancel();
      } catch {
        // noop
      }
      alert("音声再生に失敗しました（端末/ブラウザの制限の可能性があります）。");
    };

    setSpeakingWordId(wordId);

    try {
      synth.speak(u);
    } catch (e) {
      console.warn("[sapuri-wordbook] speak() failed:", e);
      setSpeakingWordId(null);
      utterRef.current = null;
      alert("音声再生に失敗しました。");
    }
  };

  // ★ 自動学習用：読み上げ完了を Promise で待てる版
  const speakWordOnceAsync = (wordId: ID, text: string) => {
    return new Promise<void>((resolve) => {
      if (typeof window === "undefined") return resolve();
      const synth = window.speechSynthesis;
      if (!synth) return resolve();

      const clean = String(text ?? "").trim();
      if (!clean) return resolve();

      try {
        synth.cancel();
      } catch {
        // noop
      }

      const u = new SpeechSynthesisUtterance(clean);
      utterRef.current = u;

      u.lang = "en-US";
      u.rate = 0.95;
      u.pitch = 1.0;
      u.volume = 1.0;

      const voices = voicesRef.current || [];
      const voice = pickEnglishVoice(voices);
      if (voice) {
        u.voice = voice;
        if (voice.lang) u.lang = voice.lang;
      }

      u.onend = () => {
        setSpeakingWordId((prev) => (prev === wordId ? null : prev));
        utterRef.current = null;
        resolve();
      };
      u.onerror = (e) => {
        console.warn("[sapuri-wordbook] speech error:", e);
        setSpeakingWordId(null);
        utterRef.current = null;
        try {
          synth.cancel();
        } catch {
          // noop
        }
        resolve(); // 自動学習は「失敗しても次へ」できるよう resolve
      };

      setSpeakingWordId(wordId);

      try {
        synth.speak(u);
      } catch (e) {
        console.warn("[sapuri-wordbook] speak() failed:", e);
        setSpeakingWordId(null);
        utterRef.current = null;
        resolve();
      }
    });
  };

  const folders = store.folders;
  const currentFolder = folders.find((f) => f.id === store.currentFolderId) ?? null;

  const totalMarkedInCurrent = currentFolder ? currentFolder.words.filter((w) => w.marked).length : 0;

  const totalStruckInCurrent = currentFolder ? currentFolder.words.filter((w) => w.struck).length : 0;

  // ---- フォルダ操作 ----
  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    setStore((s) => {
      const id = uid();
      const folder: Folder = { id, name, words: [] };
      return { ...s, folders: [...s.folders, folder], currentFolderId: id };
    });
    setNewFolderName("");
    setJsonText("");
    setSession(null);
  };

  const selectFolder = (id: ID) => {
    clearAutoTimer();
    lastAutoWordIdRef.current = null;
    stopSpeak();

    setStore((s) => ({ ...s, currentFolderId: id }));
    setJsonText("");
    setSession(null);
    setShowWordList(true);
  };

  const renameFolder = (id: ID) => {
    const folder = store.folders.find((f) => f.id === id);
    if (!folder) return;
    const name = window.prompt("フォルダ名を入力してください", folder.name);
    if (!name || !name.trim()) return;
    setStore((s) => ({
      ...s,
      folders: s.folders.map((f) => (f.id === id ? { ...f, name: name.trim() } : f)),
    }));
  };

  const deleteFolder = (id: ID) => {
    if (!confirm("このフォルダと中の単語をすべて削除します。よろしいですか？")) return;

    clearAutoTimer();
    lastAutoWordIdRef.current = null;
    stopSpeak();

    setStore((s) => {
      const nextFolders = s.folders.filter((f) => f.id !== id);
      const nextCurrent = s.currentFolderId === id ? nextFolders[0]?.id ?? null : s.currentFolderId;
      return { ...s, folders: nextFolders, currentFolderId: nextCurrent };
    });
    setJsonText("");
    setSession(null);
  };

  // ---- 単語更新（共通）----
  const updateWord = (folderId: ID, wordId: ID, updater: (w: WordItem) => WordItem) => {
    setStore((s) => ({
      ...s,
      folders: s.folders.map((f) =>
        f.id !== folderId
          ? f
          : {
              ...f,
              words: f.words.map((w: any) => {
                if (w.id !== wordId) return w;
                const fixed: WordItem = {
                  ...w,
                  marked: Boolean(w.marked),
                  struck: Boolean(w.struck),
                  pos: typeof w.pos === "string" ? w.pos : "",
                  word: String(w.word ?? ""),
                  meaning: String(w.meaning ?? ""),
                  myMeaning: typeof w.myMeaning === "string" ? w.myMeaning : String(w.myMeaning ?? ""),
                  noteKind: normalizeNoteKind(w.noteKind),
                  intransPrep: typeof w.intransPrep === "string" ? w.intransPrep : String(w.intransPrep ?? ""),
                  no: typeof w.no === "number" ? w.no : 0,
                  id: String(w.id),
                };
                return updater(fixed);
              }),
            }
      ),
    }));
  };

  const toggleWordMarked = (folderId: ID, wordId: ID) => {
    updateWord(folderId, wordId, (w) => ({ ...w, marked: !w.marked }));
  };

  const toggleWordStruck = (folderId: ID, wordId: ID) => {
    updateWord(folderId, wordId, (w) => ({ ...w, struck: !w.struck }));
  };

  // ★ 自分なり和訳 更新
  const updateMyMeaning = (folderId: ID, wordId: ID, value: string) => {
    updateWord(folderId, wordId, (w) => ({ ...w, myMeaning: value }));
  };

  // ★ Part5メモ：種別更新
  const updateNoteKind = (folderId: ID, wordId: ID, kind: NoteKind) => {
    updateWord(folderId, wordId, (w) => ({
      ...w,
      noteKind: kind,
      // 自動詞以外にしたら、前置詞は「消さずに保持」(戻した時に便利)。
      // もし消したい運用なら、ここで intransPrep: "" にしてください。
    }));
  };

  // ★ 自動詞：前置詞セット更新
  const updateIntransPrep = (folderId: ID, wordId: ID, value: string) => {
    updateWord(folderId, wordId, (w) => ({ ...w, intransPrep: value }));
  };

  const noteKindLabel = (k: NoteKind) => {
    if (k === "intransitive") return "自動詞";
    if (k === "uncountable") return "不可算名詞";
    return "その他";
  };

  // ---- JSON インポート ----
  const handleImportJson = () => {
    if (!currentFolder) {
      alert("フォルダを選択してください。");
      return;
    }
    const text = jsonText.trim();
    if (!text) {
      alert("JSON テキストを入力してください。");
      return;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error(e);
      alert("JSON のパースに失敗しました。形式を確認してください。");
      return;
    }
    if (!Array.isArray(parsed)) {
      alert("最上位が配列の JSON（[...]）にしてください。");
      return;
    }

    const newWords: WordItem[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i] ?? {};
      const noRaw = row.no ?? row.number ?? (typeof row.id === "number" ? row.id : undefined);
      const no = typeof noRaw === "number" ? noRaw : i + 1;

      const pos = row.pos ?? row.partOfSpeech ?? row.part ?? row["品詞"] ?? "";
      const word = row.word ?? row.term ?? row.english ?? row.en ?? row["英単語"] ?? "";
      const meaning = row.meaning ?? row.jp ?? row.japanese ?? row.translation ?? row["意味"] ?? "";

      if (!word || !meaning) {
        console.warn("スキップされた行:", row);
        continue;
      }

      newWords.push({
        id: uid(),
        no,
        pos: String(pos ?? ""),
        word: String(word),
        meaning: String(meaning),
        myMeaning: "",

        noteKind: "other",
        intransPrep: "",

        marked: false,
        struck: false,
      });
    }

    if (newWords.length === 0) {
      alert("有効な単語データがありませんでした。キー名と値を確認してください。");
      return;
    }

    newWords.sort((a, b) => a.no - b.no);

    setStore((s) => ({
      ...s,
      folders: s.folders.map((f) => (f.id === currentFolder.id ? { ...f, words: newWords } : f)),
    }));
    setSession(null);
    alert(`フォルダ「${currentFolder.name}」に ${newWords.length} 件の単語をインポートしました。`);
  };

  // ---- 学習セッション開始 ----
  const startSession = (mode: StudyMode, auto: boolean) => {
    clearAutoTimer();
    lastAutoWordIdRef.current = null;
    stopSpeak();

    if (!currentFolder) {
      alert("フォルダを選択してください。");
      return;
    }

    const sourceWords = mode === "all" ? currentFolder.words : currentFolder.words.filter((w) => w.marked);

    if (sourceWords.length === 0) {
      if (mode === "all") {
        alert("このフォルダには単語がありません。JSONをインポートしてください。");
      } else {
        alert("マークされた単語がありません。学習中にマークボタンを押してください。");
      }
      return;
    }

    const wordIds = sourceWords
      .slice()
      .sort((a, b) => a.no - b.no)
      .map((w) => w.id);

    const newSession: StudySession = {
      folderId: currentFolder.id,
      mode,
      auto,
      wordIds,
      currentIndex: 0,
      showAnswer: false,
      correctCount: 0,
      wrongCount: 0,
      finished: false,
    };
    setSession(newSession);
  };

  const currentSessionWord = useMemo(() => {
    if (!session || session.finished) return null;
    const folder = store.folders.find((f) => f.id === session.folderId);
    if (!folder) return null;
    const wordId = session.wordIds[session.currentIndex];
    const word = folder.words.find((w: any) => w.id === wordId) ?? null;
    if (!word) return null;

    return {
      ...word,
      struck: Boolean((word as any).struck),
      marked: Boolean((word as any).marked),
      pos: typeof (word as any).pos === "string" ? (word as any).pos : "",
      myMeaning: typeof (word as any).myMeaning === "string" ? (word as any).myMeaning : String((word as any).myMeaning ?? ""),
      noteKind: normalizeNoteKind((word as any).noteKind),
      intransPrep: typeof (word as any).intransPrep === "string" ? (word as any).intransPrep : String((word as any).intransPrep ?? ""),
    } as WordItem;
  }, [session, store]);

  // ★ 自動学習：単語が切り替わったら「音声→(スライダーms)後に解答表示」
  useEffect(() => {
    const w = currentSessionWord;
    if (!session || session.finished || !w) return;

    if (!session.auto) {
      clearAutoTimer();
      lastAutoWordIdRef.current = null;
      return;
    }

    if (session.showAnswer) return;

    if (lastAutoWordIdRef.current === w.id) return;
    lastAutoWordIdRef.current = w.id;

    clearAutoTimer();
    stopSpeak();

    let cancelled = false;

    (async () => {
      await speakWordOnceAsync(w.id, w.word);
      if (cancelled) return;

      const waitMs = clamp(Math.round(autoDelayMs), AUTO_DELAY_MIN, AUTO_DELAY_MAX);

      autoTimerRef.current = window.setTimeout(() => {
        setSession((s) => {
          if (!s || s.finished) return s;
          const nowWordId = s.wordIds[s.currentIndex];
          if (nowWordId !== w.id) return s;
          if (!s.auto) return s;
          return { ...s, showAnswer: true };
        });
        autoTimerRef.current = null;
      }, waitMs);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.auto, session?.currentIndex, session?.finished, session?.showAnswer, currentSessionWord?.id, autoDelayMs]);

  const handleShowAnswer = () => {
    if (!session || session.finished) return;
    clearAutoTimer();
    setSession((s) => (s ? { ...s, showAnswer: true } : s));
  };

  const handleMarkToggle = () => {
    if (!session || session.finished) return;
    const word = currentSessionWord;
    if (!word || !session) return;
    toggleWordMarked(session.folderId, word.id);
  };

  const handleStrikethroughToggle = () => {
    if (!session || session.finished) return;
    const word = currentSessionWord;
    if (!word || !session) return;
    toggleWordStruck(session.folderId, word.id);
  };

  const answerCommon = (isCorrect: boolean) => {
    if (!session || session.finished) return;

    clearAutoTimer();
    stopSpeak();
    lastAutoWordIdRef.current = null;

    const total = session.wordIds.length;
    const isLast = session.currentIndex >= total - 1;

    setSession((prev) => {
      if (!prev) return prev;
      const nextCorrect = prev.correctCount + (isCorrect ? 1 : 0);
      const nextWrong = prev.wrongCount + (isCorrect ? 0 : 1);
      return {
        ...prev,
        correctCount: nextCorrect,
        wrongCount: nextWrong,
        currentIndex: isLast ? prev.currentIndex : prev.currentIndex + 1,
        showAnswer: false,
        finished: isLast,
      };
    });
  };

  const handleCorrect = () => answerCommon(true);
  const handleWrong = () => answerCommon(false);
  const handleResetSession = () => {
    clearAutoTimer();
    lastAutoWordIdRef.current = null;
    stopSpeak();
    setSession(null);
  };

  const totalQuestions = session && session.wordIds ? session.wordIds.length : 0;
  const answeredCount = session ? session.correctCount + session.wrongCount : 0;
  const accuracy = answeredCount > 0 ? ((session!.correctCount / answeredCount) * 100).toFixed(1) : null;

  // ===== 単語一覧（検索・フィルタ）=====
  const listWords = useMemo(() => {
    if (!currentFolder) return [];
    const q = listQuery.trim().toLowerCase();

    let base = currentFolder.words.slice().sort((a, b) => a.no - b.no);

    if (listFilter === "marked") base = base.filter((w) => Boolean(w.marked));
    if (listFilter === "struck") base = base.filter((w) => Boolean(w.struck));

    if (q) {
      base = base.filter((w) => {
        const nk = normalizeNoteKind((w as any).noteKind);
        const hay = `${w.no} ${w.pos} ${w.word} ${w.meaning} ${w.myMeaning ?? ""} ${nk} ${(w as any).intransPrep ?? ""}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return base;
  }, [currentFolder, listQuery, listFilter]);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* 左：フォルダ一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">スタディサプリ対応英単語帳</h2>

        <div className="mb-3 text-xs text-gray-600">
          <div className="mb-1 font-medium">フォルダ一覧</div>
          {folders.length === 0 ? (
            <p className="text-xs text-gray-500">まだフォルダがありません。下のフォームから作成してください。</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {folders.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => selectFolder(f.id)}
                    className={
                      "flex-1 text-left rounded-xl px-3 py-1.5 border " +
                      (store.currentFolderId === f.id ? "bg-black text-white" : "bg-white hover:bg-gray-50")
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>{f.name}</span>
                      <span className="text-[11px] text-gray-400">{f.words.length} 語</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => renameFolder(f.id)}
                    className="text-[11px] rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                  >
                    名称
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteFolder(f.id)}
                    className="text-[11px] rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t pt-3 mt-3">
          <h3 className="text-xs font-semibold mb-1">フォルダを作成</h3>
          <div className="flex gap-2">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="flex-1 rounded-xl border px-3 py-2 text-xs"
              placeholder="例: 1〜100, 101〜200 など"
            />
            <button type="button" onClick={addFolder} className="rounded-xl bg-black px-3 py-2 text-xs text-white">
              追加
            </button>
          </div>
        </div>
      </section>

      {/* 右：フォルダ詳細 & 学習エリア */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[260px]">
        {!currentFolder ? (
          <p className="text-sm text-gray-500">左側でフォルダを選択するか、新しいフォルダを作成してください。</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold text-base">フォルダ：{currentFolder.name}</h2>
              <span className="text-xs text-gray-500">
                単語数: {currentFolder.words.length} 語 / マーク:{totalMarkedInCurrent} 語 / 取り消し線:{totalStruckInCurrent} 語
              </span>
              {speakingWordId && (
                <button
                  type="button"
                  onClick={() => {
                    clearAutoTimer();
                    stopSpeak();
                  }}
                  className="ml-auto text-[11px] rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                  title="読み上げ停止"
                >
                  🔇 停止
                </button>
              )}
            </div>

            {/* 単語一覧 */}
            <div className="rounded-xl border bg-white px-3 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-gray-700">単語一覧</h3>
                <button
                  type="button"
                  onClick={() => setShowWordList((v) => !v)}
                  className="text-[11px] rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-50"
                >
                  {showWordList ? "閉じる" : "開く"}
                </button>
              </div>

              {showWordList && (
                <>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      value={listQuery}
                      onChange={(e) => setListQuery(e.target.value)}
                      className="flex-1 min-w-[180px] rounded-xl border px-3 py-2 text-xs"
                      placeholder="検索: 単語 / 意味 / 自分訳 / 分類 / 前置詞 / 品詞 / No..."
                    />
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setListFilter("all")}
                        className={"text-[11px] rounded-lg border px-2 py-1 " + (listFilter === "all" ? "bg-black text-white" : "hover:bg-gray-50")}
                      >
                        全て
                      </button>
                      <button
                        type="button"
                        onClick={() => setListFilter("marked")}
                        className={
                          "text-[11px] rounded-lg border px-2 py-1 " +
                          (listFilter === "marked" ? "bg-yellow-100 border-yellow-400" : "hover:bg-gray-50")
                        }
                      >
                        マーク
                      </button>
                      <button
                        type="button"
                        onClick={() => setListFilter("struck")}
                        className={
                          "text-[11px] rounded-lg border px-2 py-1 " +
                          (listFilter === "struck" ? "bg-gray-100 border-gray-400" : "hover:bg-gray-50")
                        }
                      >
                        取り消し線
                      </button>
                    </div>
                  </div>

                  {currentFolder.words.length === 0 ? (
                    <p className="text-xs text-gray-500">まだ単語がありません。下の「JSON インポート」で追加してください。</p>
                  ) : listWords.length === 0 ? (
                    <p className="text-xs text-gray-500">条件に一致する単語がありません。</p>
                  ) : (
                    <div className="mt-2 max-h-[420px] overflow-auto rounded-xl border">
                      <div className="min-w-[1180px]">
                        <div className="grid grid-cols-[72px_70px_1fr_1fr_1fr_230px_220px] gap-2 px-3 py-2 text-[11px] text-gray-500 bg-gray-50 border-b">
                          <div>No</div>
                          <div>品詞</div>
                          <div>英単語</div>
                          <div>意味（元）</div>
                          <div>自分訳（入力）</div>
                          <div>分類 / 前置詞（自動詞）</div>
                          <div className="text-right">操作</div>
                        </div>

                        {listWords.map((w) => {
                          const nk = normalizeNoteKind((w as any).noteKind);
                          const prep =
                            typeof (w as any).intransPrep === "string" ? (w as any).intransPrep : String((w as any).intransPrep ?? "");
                          return (
                            <div
                              key={w.id}
                              className="grid grid-cols-[72px_70px_1fr_1fr_1fr_230px_220px] gap-2 px-3 py-2 text-xs items-center border-b last:border-b-0"
                            >
                              <div className="text-gray-500">No.{w.no}</div>
                              <div className="text-gray-600">{w.pos || "-"}</div>
                              <div className="font-medium">
                                <span className={w.struck ? "line-through" : ""}>{w.word}</span>
                              </div>
                              <div className="text-gray-700">{w.meaning}</div>

                              <div>
                                <input
                                  value={w.myMeaning ?? ""}
                                  onChange={(e) => updateMyMeaning(currentFolder.id, w.id, e.target.value)}
                                  className="w-full rounded-lg border px-2 py-1 text-xs"
                                  placeholder="自分なりの和訳"
                                />
                              </div>

                              <div className="space-y-1">
                                <select
                                  value={nk}
                                  onChange={(e) => updateNoteKind(currentFolder.id, w.id, normalizeNoteKind(e.target.value))}
                                  className="w-full rounded-lg border px-2 py-1 text-xs bg-white"
                                  title="分類（Part5メモ）"
                                >
                                  <option value="other">その他</option>
                                  <option value="intransitive">自動詞</option>
                                  <option value="uncountable">不可算名詞</option>
                                </select>

                                {nk === "intransitive" && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-gray-500 shrink-0">前置詞</span>
                                    <input
                                      value={prep}
                                      onChange={(e) => updateIntransPrep(currentFolder.id, w.id, e.target.value)}
                                      className="w-full rounded-lg border px-2 py-1 text-xs"
                                      placeholder='例: "to" / "for" / "with"...'
                                    />
                                  </div>
                                )}
                              </div>

                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => speakWord(w.id, w.word)}
                                  className={
                                    "text-[11px] rounded-lg border px-2 py-1 hover:bg-gray-50 " + (speakingWordId === w.id ? "bg-black text-white" : "")
                                  }
                                  title="発音（読み上げ）"
                                >
                                  {speakingWordId === w.id ? "🔇 停止" : "🔊"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleWordMarked(currentFolder.id, w.id)}
                                  className={
                                    "text-[11px] rounded-lg border px-2 py-1 " +
                                    (w.marked ? "bg-yellow-100 border-yellow-400" : "hover:bg-gray-50")
                                  }
                                >
                                  {w.marked ? "マーク解除" : "マーク"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleWordStruck(currentFolder.id, w.id)}
                                  className={
                                    "text-[11px] rounded-lg border px-2 py-1 " +
                                    (w.struck ? "bg-gray-100 border-gray-400" : "hover:bg-gray-50")
                                  }
                                >
                                  {w.struck ? "線ON" : "取り消し線"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-gray-500">※ 「自分訳」「分類」「前置詞」はローカルに即保存され、ホームの☁アップロードでサーバへ反映できます。</p>
                </>
              )}
            </div>

            {/* JSON インポート */}
            <div className="rounded-xl border bg-gray-50 px-3 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-gray-700">JSON インポート</h3>
                <span className="text-[11px] text-gray-500">インポートすると、このフォルダの単語は置き換えられます。</span>
              </div>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                rows={6}
                className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
                placeholder={`例:
[
  { "no": 401, "pos": "副", "word": "simply", "meaning": "単に" },
  { "no": 402, "pos": "名", "word": "background", "meaning": "背景" }
]`}
              />
              <div className="flex justify-end">
                <button type="button" onClick={handleImportJson} className="rounded-xl bg-black px-3 py-1.5 text-xs text-white">
                  このフォルダにインポート
                </button>
              </div>
            </div>

            {/* 学習モード選択 */}
            <div className="rounded-xl border bg-white px-3 py-3 space-y-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">学習モード</h3>

              {/* ★ 自動モード待ち時間スライダー */}
              <div className="rounded-xl border bg-gray-50 px-3 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-gray-700">自動：解答表示までの待ち時間</div>
                  <div className="text-xs text-gray-600 tabular-nums">{(autoDelayMs / 1000).toFixed(1)} 秒（{autoDelayMs}ms）</div>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="range"
                    min={AUTO_DELAY_MIN}
                    max={AUTO_DELAY_MAX}
                    step={AUTO_DELAY_STEP}
                    value={autoDelayMs}
                    onChange={(e) => setAutoDelayMs(Number(e.target.value))}
                    className="w-full"
                    aria-label="自動学習 解答表示までの待ち時間"
                  />
                  <button
                    type="button"
                    onClick={() => setAutoDelayMs(AUTO_DELAY_DEFAULT)}
                    className="shrink-0 text-[11px] rounded-lg border px-2 py-1 text-gray-600 hover:bg-gray-100"
                    title="1.0秒に戻す"
                  >
                    リセット
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-gray-500">※ 自動学習モードON時、「音声終了後 → この秒数」で解答が自動表示されます。</p>
              </div>

              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => startSession("all", false)}
                  className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
                  disabled={currentFolder.words.length === 0}
                >
                  すべて（手動）
                </button>
                <button
                  type="button"
                  onClick={() => startSession("all", true)}
                  className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
                  disabled={currentFolder.words.length === 0}
                  title={`音声→${(autoDelayMs / 1000).toFixed(1)}秒後に解答自動表示`}
                >
                  すべて（自動）
                </button>

                <button
                  type="button"
                  onClick={() => startSession("marked", false)}
                  className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
                  disabled={totalMarkedInCurrent === 0}
                >
                  マーク（手動）
                </button>
                <button
                  type="button"
                  onClick={() => startSession("marked", true)}
                  className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
                  disabled={totalMarkedInCurrent === 0}
                  title={`音声→${(autoDelayMs / 1000).toFixed(1)}秒後に解答自動表示`}
                >
                  マーク（自動）
                </button>

                {session && (
                  <button type="button" onClick={handleResetSession} className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50 ml-auto">
                    セッションを終了
                  </button>
                )}
              </div>

              <p className="mt-1 text-[11px] text-gray-500">※ 不正解のときは、先に「マーク」ボタンを押してから「不正解」を押すと、マーク単語モードで復習できます。</p>
            </div>

            {/* 学習カードエリア */}
            {!session ? (
              <p className="text-sm text-gray-500">モードボタン（手動 / 自動）から学習を開始してください。</p>
            ) : session.finished ? (
              <div className="rounded-2xl border bg-white px-4 py-4 space-y-2">
                <h3 className="text-sm font-semibold mb-1">結果</h3>
                <p className="text-sm">
                  正解：{session.correctCount} / {totalQuestions}
                </p>
                <p className="text-sm">
                  不正解：{session.wrongCount} / {totalQuestions}
                </p>
                <p className="text-sm font-semibold mt-1">正解率：{accuracy !== null ? `${accuracy}%` : "-"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => startSession(session.mode, session.auto)} className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50">
                    同じモードでやり直す
                  </button>
                  <button
                    type="button"
                    onClick={() => startSession("marked", session.auto)}
                    className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
                    disabled={totalMarkedInCurrent === 0}
                  >
                    マーク単語だけで復習
                  </button>
                  <button type="button" onClick={handleResetSession} className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50">
                    セッションを閉じる
                  </button>
                </div>
              </div>
            ) : !currentSessionWord ? (
              <p className="text-sm text-gray-500">単語データが見つかりません。JSONのインポート内容を確認してください。</p>
            ) : (
              <div className="rounded-2xl border bg-white px-4 py-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-gray-500">
                    {session.mode === "all" ? "モード: すべて" : "モード: マークのみ"}
                    {session.auto ? ` / 自動ON（${(autoDelayMs / 1000).toFixed(1)}s）` : " / 手動"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {session.currentIndex + 1} / {totalQuestions}
                  </div>
                </div>

                {/* 単語表示 */}
                <div className="text-center space-y-2">
                  <div className="text-[11px] text-gray-400">No.{currentSessionWord.no}</div>

                  {/* 発音 + 取り消し線 */}
                  <div className="flex justify-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => speakWord(currentSessionWord.id, currentSessionWord.word)}
                      className={"rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50 " + (speakingWordId === currentSessionWord.id ? "bg-black text-white" : "")}
                      title="発音（読み上げ）"
                    >
                      {speakingWordId === currentSessionWord.id ? "🔇 停止" : "🔊 発音"}
                    </button>

                    <button
                      type="button"
                      onClick={handleStrikethroughToggle}
                      className={
                        "rounded-xl border px-3 py-1.5 text-xs " +
                        (currentSessionWord.struck ? "bg-gray-100 border-gray-400" : "hover:bg-gray-50")
                      }
                      title="英単語に取り消し線を付ける"
                    >
                      {currentSessionWord.struck ? "取り消し線ON" : "取り消し線"}
                    </button>

                    {/* ★ 改善：分類ラベルは「解答表示後」だけ見せる（答えバレ防止） */}
                    {session.showAnswer && (
                      <span className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] text-gray-600 bg-gray-50">
                        {noteKindLabel(currentSessionWord.noteKind)}
                        {currentSessionWord.noteKind === "intransitive" && currentSessionWord.intransPrep.trim() && (
                          <span className="ml-1 text-gray-500">+ {currentSessionWord.intransPrep.trim()}</span>
                        )}
                      </span>
                    )}
                  </div>

                  <div className="text-2xl font-bold tracking-wide">
                    {currentSessionWord.pos ? (
                      <>
                        <span>{currentSessionWord.pos} </span>
                        <span className={currentSessionWord.struck ? "line-through" : ""}>{currentSessionWord.word}</span>
                      </>
                    ) : (
                      <span className={currentSessionWord.struck ? "line-through" : ""}>{currentSessionWord.word}</span>
                    )}
                  </div>
                </div>

                {/* 解答（意味）＋ 自分訳入力 ＋ 分類 */}
                <div className="mt-3 rounded-xl border bg-gray-50 px-3 py-3">
                  {!session.showAnswer ? (
                    <div className="min-h-[56px] flex items-center justify-center">
                      <span className="text-sm text-gray-400">
                        {session.auto
                          ? `自動学習中：音声終了後 ${(autoDelayMs / 1000).toFixed(1)} 秒で解答が表示されます。`
                          : "「解答をチェック」を押すと意味が表示されます。"}
                      </span>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border bg-white px-3 py-3">
                        <div className="text-[11px] text-gray-500 mb-1">意味（元データ）</div>
                        <div className="text-base font-medium">{currentSessionWord.meaning}</div>
                      </div>

                      <div className="rounded-xl border bg-white px-3 py-3 space-y-2">
                        <div className="text-[11px] text-gray-500">自分訳（右側に入力）</div>
                        <input
                          value={currentSessionWord.myMeaning ?? ""}
                          onChange={(e) => updateMyMeaning(session.folderId, currentSessionWord.id, e.target.value)}
                          className="w-full rounded-lg border px-3 py-2 text-sm"
                          placeholder="自分なりの和訳を入力"
                        />

                        <div className="grid gap-2 sm:grid-cols-[160px_1fr] items-start">
                          <div>
                            <div className="text-[11px] text-gray-500 mb-1">分類（Part5）</div>
                            <select
                              value={currentSessionWord.noteKind}
                              onChange={(e) => updateNoteKind(session.folderId, currentSessionWord.id, normalizeNoteKind(e.target.value))}
                              className="w-full rounded-lg border px-2 py-2 text-sm bg-white"
                            >
                              <option value="other">その他</option>
                              <option value="intransitive">自動詞</option>
                              <option value="uncountable">不可算名詞</option>
                            </select>
                          </div>

                          <div>
                            <div className="text-[11px] text-gray-500 mb-1">自動詞のとき：セット前置詞</div>
                            <input
                              value={currentSessionWord.intransPrep ?? ""}
                              onChange={(e) => updateIntransPrep(session.folderId, currentSessionWord.id, e.target.value)}
                              disabled={currentSessionWord.noteKind !== "intransitive"}
                              className={
                                "w-full rounded-lg border px-3 py-2 text-sm " +
                                (currentSessionWord.noteKind !== "intransitive" ? "bg-gray-50 text-gray-400" : "bg-white")
                              }
                              placeholder='例: "to" / "for" / "with"...'
                            />
                          </div>
                        </div>

                        <div className="text-[11px] text-gray-400">※ 入力はローカルに即保存（ホームの☁で同期）</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* ボタン群 */}
                {!session.showAnswer ? (
                  <div className="mt-3 flex justify-center">
                    <button type="button" onClick={handleShowAnswer} className="rounded-xl bg-black px-4 py-2 text-sm text-white">
                      解答をチェック
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2 justify-center">
                    <button
                      type="button"
                      onClick={handleMarkToggle}
                      className={
                        "rounded-xl border px-3 py-1.5 text-xs " +
                        (currentSessionWord.marked ? "bg-yellow-100 border-yellow-400" : "hover:bg-gray-50")
                      }
                    >
                      {currentSessionWord.marked ? "マーク解除" : "マーク"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCorrect}
                      className="rounded-xl border px-3 py-1.5 text-xs border-blue-500 text-blue-600 hover:bg-blue-50"
                    >
                      正解
                    </button>
                    <button
                      type="button"
                      onClick={handleWrong}
                      className="rounded-xl border px-3 py-1.5 text-xs border-red-500 text-red-600 hover:bg-red-50"
                    >
                      不正解
                    </button>
                  </div>
                )}

                {/* 途中の正解率 */}
                {answeredCount > 0 && (
                  <div className="mt-2 text-center text-xs text-gray-500">
                    現在の正解率：{accuracy}%（{session.correctCount}/{answeredCount}）
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
