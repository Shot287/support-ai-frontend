// src/features/nudge/techniques/five-second.tsx
import { useEffect, useState } from "react";
import { NudgeTechnique } from "../types";

function beep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 100);
  } catch {}
}
function vibrate(ms = 80) { if ("vibrate" in navigator) navigator.vibrate(ms); }

const FiveSecond: React.FC<{ onDone?: (note?: string) => void }> = ({ onDone }) => {
  const [running, setRunning] = useState(false);
  const [remain, setRemain] = useState(5);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    beep(); vibrate(60);
    const id = setInterval(() => {
      setRemain((r) => {
        if (r <= 1) {
          clearInterval(id);
          beep(); vibrate(120);
          setRunning(false);
          onDone?.();
          return 5;
        }
        beep(); vibrate(30);
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, onDone]);

  return (
    <div className="space-y-3">
      <div className="text-5xl font-extrabold tabular-nums">{remain}</div>
      <button
        className="rounded bg-emerald-500 px-4 py-2 text-black disabled:opacity-60"
        onClick={() => setRunning(true)}
        disabled={running}
      >
        5秒カウント開始
      </button>
    </div>
  );
};

const meta: NudgeTechnique = {
  id: "five-second",
  name: "5秒ルール",
  description: "決めたら5秒以内に動く。グズる前に身体を動かす！",
  Component: FiveSecond,
};
export default meta;
