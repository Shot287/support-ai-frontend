"use client";
import { useEffect, useRef, useState } from "react";
import { addRecord } from "./storage";

export default function PostureMini() {
  const [running, setRunning] = useState(false);
  const [startTs, setStartTs] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => { document.title = running ? `背筋 ${fmt(elapsed)}` : "背筋"; }, [running, elapsed]);

  const tick = (base: number) => {
    setElapsed(Math.floor((Date.now() - base) / 1000));
    raf.current = requestAnimationFrame(() => tick(base));
  };

  const start = () => {
    if (running) return;
    const now = Date.now();
    setStartTs(now);
    setElapsed(0);
    setRunning(true);
    raf.current && cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => tick(now));
  };

  const stop = () => {
    if (!running || !startTs) return;
    const end = Date.now();
    const durationSec = Math.max(0, Math.floor((end - startTs) / 1000));
    addRecord({ start: startTs, end, durationSec });
    setRunning(false);
    setStartTs(null);
    setElapsed(0);
    document.title = "背筋 ✓ 記録しました";
  };

  useEffect(() => {
    const onBeforeUnload = () => {
      if (running && startTs) {
        const end = Date.now();
        const durationSec = Math.max(0, Math.floor((end - startTs) / 1000));
        addRecord({ start: startTs, end, durationSec });
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [running, startTs]);

  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-[280px] rounded-2xl border p-4 text-center select-none">
        <div className="text-sm text-gray-500">ビジュアルリマインダー</div>
        <div className="mt-1 text-lg font-semibold">背筋</div>

        <div className="mt-4 text-4xl font-bold tabular-nums">{fmt(elapsed)}</div>

        <div className="mt-5 flex gap-3 justify-center">
          {!running ? (
            <button onClick={start} className="rounded-xl bg-black text-white px-4 py-2" autoFocus>開始</button>
          ) : (
            <button onClick={stop} className="rounded-xl border px-4 py-2">終了</button>
          )}
        </div>

        <div className="mt-3 text-xs text-gray-500">このウィンドウは閉じてもOK（計測中は自動記録）</div>
      </div>
    </main>
  );
}

function fmt(sec: number) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}
