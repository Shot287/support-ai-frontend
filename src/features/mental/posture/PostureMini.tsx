"use client";
import { useEffect, useRef, useState } from "react";
import { addRecord } from "./storage";

/**
 * コンパクト版ミニウィンドウ
 * - 表示はタイマー＋開始/終了ボタンのみ
 * - 終了押下時に必ずアニメーション更新を停止（cancelAnimationFrame）
 * - beforeunload でも未保存の計測を自動保存
 */
export default function PostureMini() {
  const [running, setRunning] = useState(false);
  const [startTs, setStartTs] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false); // ループのガード用

  // タイトルは経過中のみ mm:ss を表示（最小限）
  useEffect(() => {
    document.title = running ? fmt(elapsed) : "Timer";
  }, [running, elapsed]);

  // ループ（runningRef で停止ガード）
  const loop = (base: number) => {
    if (!runningRef.current) return;
    setElapsed(Math.floor((Date.now() - base) / 1000));
    rafRef.current = requestAnimationFrame(() => loop(base));
  };

  const start = () => {
    if (running) return;
    const now = Date.now();
    runningRef.current = true;
    setStartTs(now);
    setElapsed(0);
    setRunning(true);

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => loop(now));
  };

  const stop = () => {
    if (!running || !startTs) return;

    // 現時点の経過を確定
    const end = Date.now();
    const durationSec = Math.max(0, Math.floor((end - startTs) / 1000));

    // アニメーション停止＆状態更新（ここが重要）
    runningRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setRunning(false);
    setStartTs(null);
    setElapsed(durationSec); // 表示を確定値で止める

    // 記録保存
    addRecord({ start: end - durationSec * 1000, end, durationSec });
    document.title = "Saved";
  };

  // 計測中に閉じられても自動保存
  useEffect(() => {
    const onBeforeUnload = () => {
      if (runningRef.current && startTs) {
        const end = Date.now();
        const durationSec = Math.max(0, Math.floor((end - startTs) / 1000));
        addRecord({ start: startTs, end, durationSec });
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [startTs]);

  // アンマウント時に念のため停止
  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <main className="min-h-dvh flex items-center justify-center p-2">
      <div className="w-[220px] rounded-xl border p-3 text-center select-none">
        <div className="text-3xl font-mono font-bold tabular-nums tracking-wider">
          {fmt(elapsed)}
        </div>

        <div className="mt-3 flex gap-2 justify-center">
          {!running ? (
            <button
              onClick={start}
              className="w-full rounded-lg bg-black text-white px-3 py-2"
              autoFocus
            >
              開始
            </button>
          ) : (
            <button
              onClick={stop}
              className="w-full rounded-lg border px-3 py-2"
            >
              終了
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function fmt(sec: number) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}
