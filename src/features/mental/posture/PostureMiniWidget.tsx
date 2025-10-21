"use client";
import { useEffect, useRef, useState } from "react";
import { addRecord } from "./storage";

/** 小窓に描画する最小構成ウィジェット（タイマー＋開始/終了） */
export default function PostureMiniWidget() {
  const [running, setRunning] = useState(false);
  const [startTs, setStartTs] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    document.title = running ? fmt(elapsed) : "Timer";
  }, [running, elapsed]);

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
    const end = Date.now();
    const durationSec = Math.max(0, Math.floor((end - startTs) / 1000));
    runningRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);  // ← rafRefRef の typo を修正
      rafRef.current = null;
    }
    setRunning(false);
    setStartTs(null);
    setElapsed(durationSec);
    addRecord({ start: end - durationSec * 1000, end, durationSec });
    document.title = "Saved";
  };

  // 閉じられても自動保存
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

  // アンマウント時に停止
  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="w-[220px] rounded-xl border p-3 text-center select-none bg-white">
      <div className="text-3xl font-mono font-bold tabular-nums tracking-wider">{fmt(elapsed)}</div>
      <div className="mt-3 flex gap-2 justify-center">
        {!running ? (
          <button onClick={start} className="w-full rounded-lg bg-black text-white px-3 py-2" autoFocus>
            開始
          </button>
        ) : (
          <button onClick={stop} className="w-full rounded-lg border px-3 py-2">
            終了
          </button>
        )}
      </div>
    </div>
  );
}

function fmt(sec: number) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}
