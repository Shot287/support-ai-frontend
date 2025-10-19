// src/features/nudge/techniques/five-second.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export default function FiveSecond() {
  const [count, setCount] = useState(5);
  const [running, setRunning] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clear = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const tick = useCallback(() => {
    setCount((c) => {
      if (c <= 1) {
        // 0 に到達
        clear();
        setRunning(false);
        return 0;
      }
      return c - 1;
    });
  }, []);

  const start = () => {
    clear();
    setCount(5);
    setRunning(true);
    timerRef.current = window.setInterval(tick, 1000);
  };

  const stop = () => {
    clear();
    setRunning(false);
  };

  const reset = () => {
    stop();
    setCount(5);
  };

  useEffect(() => {
    return () => clear(); // アンマウント時に後始末
  }, []);

  return (
    <div className="rounded-2xl border p-6 shadow-sm">
      <div className="text-center">
        <div className="text-7xl font-bold tabular-nums">{count}</div>
        <p className="mt-2 text-gray-600">5→1で迷いを断ち切って、今すぐ動く！</p>

        <div className="mt-6 flex items-center justify-center gap-3">
          {!running ? (
            <button
              onClick={start}
              className="rounded-xl bg-black px-5 py-2 text-white hover:opacity-90"
            >
              スタート
            </button>
          ) : (
            <button
              onClick={stop}
              className="rounded-xl bg-gray-800 px-5 py-2 text-white hover:opacity-90"
            >
              ストップ
            </button>
          )}
          <button
            onClick={reset}
            className="rounded-xl border px-5 py-2 hover:bg-gray-50"
          >
            リセット
          </button>
        </div>

        {count === 0 && (
          <div className="mt-6 text-lg font-semibold text-green-700">
            いま動く！— 最初の1アクションを実行しよう
          </div>
        )}
      </div>
    </div>
  );
}
