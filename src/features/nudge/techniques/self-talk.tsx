"use client";

import { useEffect, useMemo, useState } from "react";

/* ========= 型 ========= */
type ID = string;
type SelfTalkPhrase = string; // 1フレーズ
type SelfTalkSet = {
  id: ID;
  title: string;
  phrases: SelfTalkPhrase[]; // 11個
  createdAt: number;
};
type StoreShape = {
  sets: SelfTalkSet[];
  version: 1;
};

/* ========= 定数 ========= */
const STORE_KEY = "selftalk_v1";
const REQUIRED_COUNT = 11;

// デフォルト11フレーズ（ご指定の文言をそのまま採用）
const DEFAULT_PHRASES: string[] = [
  "この仕事は、明日まで先延ばしにするよりも、今すぐ始めた方がうまくいくはずだ！",
  "このタスクを避けているせいで不安、恥、心配の感情が起きてるが、この感情から自分を解放してみる価値があるはず！",
  "自分がこの仕事を避けているのは、それが「◯◯◯◯（末尾の例から自分に当てはまるものを挿入する）」を呼び起こすだろうと予想しているからだ。しかし、私は以前にも、そのような感情や状況をやりすごした経験があるはず！　（◯◯◯◯に入るものの例＝退屈、不安、疑い、恥、怒り、対人関係での衝突、気まずさまたは拒絶・喪失、過去の失敗の記憶）",
  "このタスクは、私が過去に起こした失敗したか、気まずい行動、無力さだったかの記憶を呼び起こしている。このような記憶は苦痛だが、このような痛みは、人間なら誰でも体験するものでもある。誰もがこのような体験をくぐり抜けてきたものだし、誰もが過去の経験から学ぶものだ！",
  "私が仕事を避けたい衝動に駆られているのは、私が感情的に成熟していないからだとか、私が無能だからといったことを意味しない。私が感じていることは、人間なら誰でも経験することだ！　すべての大人は、これらの衝動を克服するスキルを学ぶ必要があるものなのだ！",
  "このタスクを先延ばししているのは、起こりうる結果が怖いからだ。このタスクを怖いと感じるのは「◯◯◯◯」だ (自分が予想している怖い結果を挿入する)。しかし、他の結果もあり得るし、そのタスクを回避しても、現実が現状と異なるものになるわけではない！",
  "このタスクはネガティブな感情をかきたてるが、それは決して耐えられないものではない！",
  "私は自分の脳内で作った妄想に反応しているのか？　それとも目の前の現実に反応しているのだろうか？　こんなときは、目の前の現実を直視することを選ぶことで、事態を先に進めることができる！",
  "とりあえず、避けていたタスクに非常に短い時間（例えば5〜60分）を費やしてみたらどうだろう？　これは、より快適で楽だが意味が薄いタスクに長い時間を費やすよりも生産的に感じられるのは間違いない。そうすれば、その日の残りの時間を、安心感と解放感を味わいながら過ごすことができるはずだ！",
  "この仕事に完璧を求めない。今までで最高のパフォーマンスをする必要はない！　最初からすべてを正しくやろうと思ったら、タスクは実際よりも大変なものに見えてしまう！　私は、このタスクを最高に行う必要はなく、ただうまくやればいいのだ！",
  "タスクは進めさえすればいい！それだけでも大きな安心感を得ることができる。今日中に完成させる必要はないのだ！",
];

const DEFAULT_SET_TITLE = "基本セット";

/* ========= ユーティリティ ========= */
const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function ensure11(phrases: string[]): string[] {
  const arr = phrases.slice(0, REQUIRED_COUNT);
  while (arr.length < REQUIRED_COUNT) arr.push("");
  return arr;
}

function loadStore(): StoreShape {
  try {
    const raw =
      typeof window !== "undefined" ? localStorage.getItem(STORE_KEY) : null;
    if (!raw) {
      // 初回：デフォルト1セットを生成
      return {
        sets: [
          {
            id: uid(),
            title: DEFAULT_SET_TITLE,
            phrases: ensure11(DEFAULT_PHRASES),
            createdAt: Date.now(),
          },
        ],
        version: 1,
      };
    }
    const parsed = JSON.parse(raw) as StoreShape;
    // 念のため各セットの長さを11に合わせる
    parsed.sets = parsed.sets.map((s) => ({
      ...s,
      phrases: ensure11(s.phrases ?? []),
    }));
    return parsed;
  } catch {
    return {
      sets: [
        {
          id: uid(),
          title: DEFAULT_SET_TITLE,
          phrases: ensure11(DEFAULT_PHRASES),
          createdAt: Date.now(),
        },
      ],
      version: 1,
    };
  }
}
function saveStore(s: StoreShape) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }
}

/* ========= 本体コンポーネント ========= */
export default function SelfTalk() {
  const [store, setStore] = useState<StoreShape>(() => loadStore());
  const [selectedSetId, setSelectedSetId] = useState<ID>(() =>
    (loadStore().sets[0]?.id) ?? ""
  );
  const [index, setIndex] = useState(0); // 0..10
  const [isEditing, setIsEditing] = useState(false);
  const [tmpTitle, setTmpTitle] = useState("");

  const currentSet = useMemo(
    () => store.sets.find((s) => s.id === selectedSetId) ?? store.sets[0],
    [store.sets, selectedSetId]
  );
  const phrase = currentSet?.phrases[index] ?? "";

  useEffect(() => saveStore(store), [store]);

  const setPhrase = (i: number, value: string) => {
    if (!currentSet) return;
    setStore((s) => ({
      ...s,
      sets: s.sets.map((set) =>
        set.id === currentSet.id
          ? { ...set, phrases: set.phrases.map((p, j) => (j === i ? value : p)) }
          : set
      ),
    }));
  };

  const addSet = () => {
    const title = prompt("新しいセットのタイトルを入力してください", "勉強セット");
    if (!title) return;
    const newSet: SelfTalkSet = {
      id: uid(),
      title,
      phrases: ensure11(DEFAULT_PHRASES), // デフォルトから開始（空配列から始めたい場合は [] に変更）
      createdAt: Date.now(),
    };
    setStore((s) => ({ ...s, sets: [...s.sets, newSet] }));
    setSelectedSetId(newSet.id);
    setIndex(0);
  };

  const renameSet = () => {
    if (!currentSet) return;
    const newTitle = prompt("セットの新しいタイトル", currentSet.title);
    if (!newTitle) return;
    setStore((s) => ({
      ...s,
      sets: s.sets.map((set) =>
        set.id === currentSet.id ? { ...set, title: newTitle } : set
      ),
    }));
  };

  const deleteSet = () => {
    if (!currentSet) return;
    if (store.sets.length <= 1) {
      alert("少なくとも1つのセットが必要です。削除できません。");
      return;
    }
    if (!confirm(`セット「${currentSet.title}」を削除します。よろしいですか？`)) return;
    setStore((s) => {
      const next = s.sets.filter((set) => set.id !== currentSet.id);
      return { ...s, sets: next };
    });
    // セット変更
    setTimeout(() => {
      const first = (store.sets.find((s) => s.id !== currentSet.id) ?? store.sets[0])?.id;
      setSelectedSetId(first);
      setIndex(0);
    });
  };

  const prev = () => setIndex((i) => (i - 1 + REQUIRED_COUNT) % REQUIRED_COUNT);
  const next = () => setIndex((i) => (i + 1) % REQUIRED_COUNT);

  return (
    <div className="space-y-4">
      {/* ヘッダ：セット選択＋操作 */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">セット：</label>
          <select
            value={currentSet?.id ?? ""}
            onChange={(e) => {
              setSelectedSetId(e.target.value as ID);
              setIndex(0);
            }}
            className="rounded-xl border px-3 py-2"
          >
            {store.sets
              .slice()
              .sort((a, b) => a.createdAt - b.createdAt)
              .map((set) => (
                <option key={set.id} value={set.id}>
                  {set.title}
                </option>
              ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={addSet} className="rounded-xl border px-3 py-2 hover:bg-gray-50">
            セット追加
          </button>
          <button onClick={renameSet} className="rounded-xl border px-3 py-2 hover:bg-gray-50">
            タイトル変更
          </button>
          <button onClick={deleteSet} className="rounded-xl border px-3 py-2 hover:bg-gray-50">
            セット削除
          </button>
          <button
            onClick={() => setIsEditing((v) => !v)}
            className="rounded-xl border px-3 py-2 hover:bg-gray-50"
          >
            {isEditing ? "閲覧モード" : "編集モード"}
          </button>
        </div>
      </div>

      {/* ページャ（1フレーズ/ページ） */}
      <div className="flex items-center justify-between">
        <button onClick={prev} className="rounded-xl border px-3 py-2 hover:bg-gray-50">
          ← 前へ
        </button>
        <div className="text-sm text-gray-600">
          {index + 1} / {REQUIRED_COUNT}
        </div>
        <button onClick={next} className="rounded-xl border px-3 py-2 hover:bg-gray-50">
          次へ →
        </button>
      </div>

      {/* 表示/編集エリア */}
      {!isEditing ? (
        <div className="card p-4 text-lg leading-8 whitespace-pre-wrap">
          {phrase || "（未入力）"}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={phrase}
            onChange={(e) => setPhrase(index, e.target.value)}
            className="w-full min-h-40 rounded-xl border p-3"
            placeholder="このページのセルフトークを書いてください"
          />
          <div className="text-right text-sm text-gray-500">自動保存されています</div>
        </div>
      )}

      {/* ヒント */}
      <div className="text-xs text-gray-500">
        ヒント：セットを複数作成して「勉強」「筋トレ」などに分けられます（各セットは11フレーズ固定）。
      </div>
    </div>
  );
}
