"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [info, setInfo] = useState({
    w: 0, h: 0, dvh: 0, dpr: 0, ua: "", online: true
  });
  const [text, setText] = useState("");
  const [count, setCount] = useState(0);

  // 画面情報の更新
  const read = () => setInfo({
    w: window.innerWidth,
    h: window.innerHeight,
    dvh: Math.round((window.innerHeight / 100) * 100) / 100,
    dpr: window.devicePixelRatio ?? 1,
    ua: navigator.userAgent,
    online: navigator.onLine
  });

  useEffect(() => {
    read();
    const onResize = () => read();
    const onOnline = () => read();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
    };
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* 固定ヘッダ */}
      <header className="sticky top-0 z-10 border-b border-black/10 dark:border-white/15 bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-base font-bold">スマホ動作確認ページ</h1>
          <span className="text-xs opacity-70">Tailwind v4 / PWA準備済み</span>
        </div>
      </header>

      {/* 本体 */}
      <div className="mx-auto max-w-3xl px-4 py-5 space-y-6">
        {/* デバイス情報 */}
        <section className="rounded border border-black/10 dark:border-white/15 p-3 bg-white dark:bg-black/10">
          <h2 className="font-semibold mb-2">デバイス情報</h2>
          <div className="grid grid-cols-2 gap-y-1 text-sm">
            <div>innerWidth</div><div className="text-right">{info.w}px</div>
            <div>innerHeight</div><div className="text-right">{info.h}px</div>
            <div>devicePixelRatio</div><div className="text-right">{info.dpr}</div>
            <div>online</div><div className="text-right">{String(info.online)}</div>
          </div>
          <details className="mt-2 text-xs opacity-80 break-all">
            <summary>userAgent</summary>
            {info.ua}
          </details>
        </section>

        {/* タップ&スクロール確認 */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              className="rounded bg-black text-white h-10 px-4"
              onClick={() => setCount((c) => c + 1)}
            >
              タップ (+1)
            </button>
            <span>count: <strong>{count}</strong></span>
            <button
              className="rounded border border-black/10 dark:border-white/15 h-10 px-4"
              onClick={() => setCount(0)}
            >
              リセット
            </button>
          </div>

          <div className="rounded border border-black/10 dark:border-white/15 p-3 bg-white dark:bg-black/10 h-48 overflow-y-auto">
            <p className="text-sm opacity-80">
              スクロール確認用のボックスです。スマホで指でスクロールしてみてください。
            </p>
            <ul className="list-disc pl-5 text-sm space-y-1 mt-2">
              {Array.from({ length: 30 }).map((_, i) => (
                <li key={i}>Item {i + 1}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* キーボード挙動確認 */}
        <section className="space-y-2">
          <label className="block text-sm font-medium">
            入力（ソフトキーボード表示・隠れるか確認）
            <input
              className="mt-1 w-full rounded border border-black/10 dark:border-white/15 p-2 bg-white dark:bg-black/10 outline-none focus:ring-2 focus:ring-black/20"
              placeholder="ここに入力"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p className="text-sm opacity-70">値: {text || "(空)"}</p>
        </section>

        {/* 下部余白（安全領域） */}
        <div className="h-[16dvh]" />
      </div>

      {/* 固定ボトムバー（キーボードで隠れないか確認） */}
      <div className="fixed inset-x-0 bottom-0 bg-background/90 backdrop-blur border-t border-black/10 dark:border-white/15">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <span className="text-sm opacity-70">Bottom Bar</span>
          <a
            className="rounded bg-black text-white h-10 px-4 flex items-center"
            href="#top"
          >
            上へ
          </a>
        </div>
      </div>
    </main>
  );
}
