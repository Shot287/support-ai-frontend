// src/features/study/sapuri-wordbook.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";
import { registerManualSync } from "@/lib/manual-sync";

type ID = string;

type WordItem = {
  id: ID;
  no: number;      // スタディサプリの番号（1〜100 など）
  pos: string;     // 品詞（例: "名", "動", "副" など）
  word: string;    // 英単語
  meaning: string; // 日本語の意味
  marked: boolean; // マーク対象かどうか
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
            marked: Boolean(w.marked),
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
      currentFolderId:
        typeof parsed.currentFolderId === "string"
          ? parsed.currentFolderId
          : def.currentFolderId,
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

// ===== 学習セッション用型 =====
type StudyMode = "all" | "marked";

type StudySession = {
  folderId: ID;
  mode: StudyMode;
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

  // ---- Store 変更時：localStorage に即保存（サーバ同期は manual-sync 任せ） ----
  useEffect(() => {
    storeRef.current = store;
    saveLocal(store);
  }, [store]);

  // ---- 手動同期への登録 ----
  useEffect(() => {
    const unsubscribe = registerManualSync({
      // サーバ → ローカル
      pull: async () => {
        try {
          const remote = await loadUserDoc<Store>(DOC_KEY);
          if (remote && remote.version === 1) {
            // remote 側にも pos が無い可能性に軽く対応
            const fixed: Store = {
              ...remote,
              folders: remote.folders.map((f) => ({
                ...f,
                words: f.words.map((w) => ({
                  ...w,
                  pos: typeof w.pos === "string" ? w.pos : "",
                })),
              })),
            };
            setStore(fixed);
            saveLocal(fixed);
          }
        } catch (e) {
          console.warn("[sapuri-wordbook] manual PULL failed:", e);
        }
      },
      // ローカル → サーバ
      push: async () => {
        try {
          await saveUserDoc<Store>(DOC_KEY, storeRef.current);
        } catch (e) {
          console.warn("[sapuri-wordbook] manual PUSH failed:", e);
        }
      },
      // 今回は特にリセット処理なし
      reset: async () => {
        /* no-op */
      },
    });

    return unsubscribe;
  }, []);

  const folders = store.folders;
  const currentFolder =
    folders.find((f) => f.id === store.currentFolderId) ?? null;

  const totalMarkedInCurrent = currentFolder
    ? currentFolder.words.filter((w) => w.marked).length
    : 0;

  // ---- フォルダ操作 ----
  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    setStore((s) => {
      const id = uid();
      const folder: Folder = {
        id,
        name,
        words: [],
      };
      return {
        ...s,
        folders: [...s.folders, folder],
        currentFolderId: id,
      };
    });
    setNewFolderName("");
    setJsonText("");
    setSession(null);
  };

  const selectFolder = (id: ID) => {
    setStore((s) => ({
      ...s,
      currentFolderId: id,
    }));
    setJsonText("");
    setSession(null);
  };

  const renameFolder = (id: ID) => {
    const folder = store.folders.find((f) => f.id === id);
    if (!folder) return;
    const name = window.prompt("フォルダ名を入力してください", folder.name);
    if (!name || !name.trim()) return;
    setStore((s) => ({
      ...s,
      folders: s.folders.map((f) =>
        f.id === id ? { ...f, name: name.trim() } : f
      ),
    }));
  };

  const deleteFolder = (id: ID) => {
    if (!confirm("このフォルダと中の単語をすべて削除します。よろしいですか？"))
      return;
    setStore((s) => {
      const nextFolders = s.folders.filter((f) => f.id !== id);
      const nextCurrent =
        s.currentFolderId === id ? nextFolders[0]?.id ?? null : s.currentFolderId;
      return {
        ...s,
        folders: nextFolders,
        currentFolderId: nextCurrent,
      };
    });
    setJsonText("");
    setSession(null);
  };

  // ---- JSON インポート ----
  /**
   * 期待フォーマット（例）:
   * [
   *   { "no": 1, "pos": "名", "word": "department", "meaning": "部門" },
   *   { "no": 2, "pos": "副", "word": "simply",     "meaning": "単に" }
   * ]
   *
   * キー名は多少ゆるく対応:
   * - 番号: no / number / id
   * - 品詞: pos / partOfSpeech / part / 品詞
   * - 英語: word / term / english / en / 英単語
   * - 意味: meaning / jp / japanese / translation / 意味
   */
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
      const noRaw =
        row.no ?? row.number ?? (typeof row.id === "number" ? row.id : undefined);
      const no =
        typeof noRaw === "number"
          ? noRaw
          : i + 1; // 番号が無い場合は 1,2,3,... と振る

      const pos =
        row.pos ??
        row.partOfSpeech ??
        row.part ??
        row["品詞"] ??
        "";

      const word =
        row.word ??
        row.term ??
        row.english ??
        row.en ??
        row["英単語"] ??
        "";
      const meaning =
        row.meaning ??
        row.jp ??
        row.japanese ??
        row.translation ??
        row["意味"] ??
        "";

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
        marked: false,
      });
    }

    if (newWords.length === 0) {
      alert("有効な単語データがありませんでした。キー名と値を確認してください。");
      return;
    }

    // 番号順に並べ替え
    newWords.sort((a, b) => a.no - b.no);

    setStore((s) => ({
      ...s,
      folders: s.folders.map((f) =>
        f.id === currentFolder.id ? { ...f, words: newWords } : f
      ),
    }));
    setSession(null);
    alert(
      `フォルダ「${currentFolder.name}」に ${newWords.length} 件の単語をインポートしました。`
    );
  };

  // ---- 学習セッション開始 ----
  const startSession = (mode: StudyMode) => {
    if (!currentFolder) {
      alert("フォルダを選択してください。");
      return;
    }
    const sourceWords =
      mode === "all"
        ? currentFolder.words
        : currentFolder.words.filter((w) => w.marked);

    if (sourceWords.length === 0) {
      if (mode === "all") {
        alert("このフォルダには単語がありません。JSONをインポートしてください。");
      } else {
        alert("マークされた単語がありません。学習中にマークボタンを押してください。");
      }
      return;
    }

    // 番号順（必要ならここでシャッフルも可）
    const wordIds = sourceWords
      .slice()
      .sort((a, b) => a.no - b.no)
      .map((w) => w.id);

    const newSession: StudySession = {
      folderId: currentFolder.id,
      mode,
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
    const word = folder.words.find((w) => w.id === wordId) ?? null;
    return word;
  }, [session, store]);

  const handleShowAnswer = () => {
    if (!session || session.finished) return;
    setSession((s) => (s ? { ...s, showAnswer: true } : s));
  };

  const handleMarkToggle = () => {
    if (!session || session.finished) return;
    const word = currentSessionWord;
    if (!word) return;

    setStore((s) => ({
      ...s,
      folders: s.folders.map((f) =>
        f.id !== session.folderId
          ? f
          : {
              ...f,
              words: f.words.map((w) =>
                w.id === word.id ? { ...w, marked: !w.marked } : w
              ),
            }
      ),
    }));
  };

  const answerCommon = (isCorrect: boolean) => {
    if (!session || session.finished) return;

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

  const handleCorrect = () => {
    answerCommon(true);
  };

  const handleWrong = () => {
    answerCommon(false);
  };

  const handleResetSession = () => {
    setSession(null);
  };

  const totalQuestions =
    session && session.wordIds ? session.wordIds.length : 0;
  const answeredCount =
    session ? session.correctCount + session.wrongCount : 0;
  const accuracy =
    answeredCount > 0
      ? ((session!.correctCount / answeredCount) * 100).toFixed(1)
      : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* 左：フォルダ一覧 */}
      <section className="rounded-2xl border p-4 shadow-sm">
        <h2 className="font-semibold mb-3">スタディサプリ対応英単語帳</h2>

        <div className="mb-3 text-xs text-gray-600">
          <div className="mb-1 font-medium">フォルダ一覧</div>
          {folders.length === 0 ? (
            <p className="text-xs text-gray-500">
              まだフォルダがありません。下のフォームから作成してください。
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {folders.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-2"
                >
                  <button
                    type="button"
                    onClick={() => selectFolder(f.id)}
                    className={
                      "flex-1 text-left rounded-xl px-3 py-1.5 border " +
                      (store.currentFolderId === f.id
                        ? "bg-black text-white"
                        : "bg-white hover:bg-gray-50")
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>{f.name}</span>
                      <span className="text-[11px] text-gray-400">
                        {f.words.length} 語
                      </span>
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
            <button
              type="button"
              onClick={addFolder}
              className="rounded-xl bg-black px-3 py-2 text-xs text-white"
            >
              追加
            </button>
          </div>
        </div>
      </section>

      {/* 右：フォルダ詳細 & 学習エリア */}
      <section className="rounded-2xl border p-4 shadow-sm min-h-[260px]">
        {!currentFolder ? (
          <p className="text-sm text-gray-500">
            左側でフォルダを選択するか、新しいフォルダを作成してください。
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold text-base">
                フォルダ：{currentFolder.name}
              </h2>
              <span className="text-xs text-gray-500">
                単語数: {currentFolder.words.length} 語 / マーク:
                {totalMarkedInCurrent} 語
              </span>
            </div>

            {/* JSON インポート */}
            <div className="rounded-xl border bg-gray-50 px-3 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-gray-700">
                  JSON インポート
                </h3>
                <span className="text-[11px] text-gray-500">
                  インポートすると、このフォルダの単語は置き換えられます。
                </span>
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
                <button
                  type="button"
                  onClick={handleImportJson}
                  className="rounded-xl bg-black px-3 py-1.5 text-xs text-white"
                >
                  このフォルダにインポート
                </button>
              </div>
            </div>

            {/* 学習モード選択 */}
            <div className="rounded-xl border bg-white px-3 py-3 space-y-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                学習モード
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => startSession("all")}
                  className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
                  disabled={currentFolder.words.length === 0}
                >
                  すべての単語から学習
                </button>
                <button
                  type="button"
                  onClick={() => startSession("marked")}
                  className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
                  disabled={totalMarkedInCurrent === 0}
                >
                  マークした単語だけ学習
                </button>
                {session && (
                  <button
                    type="button"
                    onClick={handleResetSession}
                    className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50 ml-auto"
                  >
                    セッションを終了
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                ※ 不正解のときは、先に「マーク」ボタンを押してから「不正解」を押すと、
                マーク単語モードで復習できます。
              </p>
            </div>

            {/* 学習カードエリア */}
            {!session ? (
              <p className="text-sm text-gray-500">
                モードボタン（すべて / マークだけ）から学習を開始してください。
              </p>
            ) : session.finished ? (
              <div className="rounded-2xl border bg-white px-4 py-4 space-y-2">
                <h3 className="text-sm font-semibold mb-1">結果</h3>
                <p className="text-sm">
                  正解：{session.correctCount} / {totalQuestions}
                </p>
                <p className="text-sm">
                  不正解：{session.wrongCount} / {totalQuestions}
                </p>
                <p className="text-sm font-semibold mt-1">
                  正解率：
                  {accuracy !== null ? `${accuracy}%` : "-"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startSession(session.mode)}
                    className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
                  >
                    同じモードでやり直す
                  </button>
                  <button
                    type="button"
                    onClick={() => startSession("marked")}
                    className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
                    disabled={totalMarkedInCurrent === 0}
                  >
                    マーク単語だけで復習
                  </button>
                  <button
                    type="button"
                    onClick={handleResetSession}
                    className="rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50"
                  >
                    セッションを閉じる
                  </button>
                </div>
              </div>
            ) : !currentSessionWord ? (
              <p className="text-sm text-gray-500">
                単語データが見つかりません。JSONのインポート内容を確認してください。
              </p>
            ) : (
              <div className="rounded-2xl border bg-white px-4 py-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-gray-500">
                    {session.mode === "all" ? "モード: すべて" : "モード: マークのみ"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {session.currentIndex + 1} / {totalQuestions}
                  </div>
                </div>

                {/* 単語表示（問題側: 品詞 + 英単語） */}
                <div className="text-center space-y-1">
                  <div className="text-[11px] text-gray-400">
                    No.{currentSessionWord.no}
                  </div>
                  <div className="text-2xl font-bold tracking-wide">
                    {currentSessionWord.pos
                      ? `${currentSessionWord.pos} ${currentSessionWord.word}`
                      : currentSessionWord.word}
                  </div>
                </div>

                {/* 解答（意味） */}
                <div className="mt-3 rounded-xl border bg-gray-50 px-3 py-3 min-h-[56px] flex items-center justify-center">
                  {session.showAnswer ? (
                    <span className="text-base font-medium">
                      {currentSessionWord.meaning}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">
                      「解答をチェック」を押すと意味が表示されます。
                    </span>
                  )}
                </div>

                {/* ボタン群 */}
                {!session.showAnswer ? (
                  <div className="mt-3 flex justify-center">
                    <button
                      type="button"
                      onClick={handleShowAnswer}
                      className="rounded-xl bg-black px-4 py-2 text-sm text-white"
                    >
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
                        (currentSessionWord.marked
                          ? "bg-yellow-100 border-yellow-400"
                          : "hover:bg-gray-50")
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
                    現在の正解率：{accuracy}%（
                    {session.correctCount}/{answeredCount}）
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
