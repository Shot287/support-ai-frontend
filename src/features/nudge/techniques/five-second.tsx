"use client";

import { useEffect, useRef, useState } from "react";
import type { TechniqueComponentProps, TechniqueResult } from "../types";

export default function FiveSecondCountdown({
  onComplete,
  onCancel,
}: TechniqueComponentProps) {
  const [secondsLeft, setSecondsLeft] = useState<number>(5);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  // 開始
  useEffect(() => {
    startedAtRef.current = performance.now();
    timerRef.current = window.setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => {
      if (timerRef.current != null) clearInterval(timerRef.current);
    };
  }, []);

  // 0 で完了通知
  useEffect(() => {
    if (secondsLeft === 0) {
      if (timerRef.current != null) clearInterval(timerRef.current);
      const end = performance.now();
      const durationMs =
        startedAtRef.current != null
          ? Math.round(end - startedAtRef.current)
          : undefined;
      const result: TechniqueResult = {
        techniqueId: "five-second",
        success: true,
        durationMs,
        notes: "自発的開始のきっかけ作りに成功",
      };
      onComplete(result);
    }
  }, [secondsLeft, onComplete]);

  return (
    <div className="rounded-xl border border-black/10 dark:border-white/15 p-4 bg-white dark:bg-black/10">
      <div className="text-6xl font-extrabold text-center tabular-nums">
        {secondsLeft}
      </div>
      <p className="mt-2 text-sm text-center opacity-70">
        「5」から「0」になったら、すぐに最初の1分だけ手を動かそう。
      </p>
      <div className="mt-3 flex justify-center gap-2">
        <button
          className="rounded bg-black text-white h-10 px-4"
          onClick={() => {
            if (timerRef.current != null) clearInterval(timerRef.current);
            const end = performance.now();
            const durationMs =
              startedAtRef.current != null
                ? Math.round(end - startedAtRef.current)
                : undefined;
            const result: TechniqueResult = {
              techniqueId: "five-second",
              success: false,
              durationMs,
              notes: "カウント途中で完了扱いにした",
            };
            onComplete(result);
          }}
        >
          途中で完了扱い
        </button>
        <button
          className="rounded border border-black/10 dark:border-white/15 h-10 px-4"
          onClick={onCancel}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
