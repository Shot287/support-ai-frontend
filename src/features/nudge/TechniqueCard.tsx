// src/features/nudge/TechniqueCard.tsx
import { NudgeTechnique } from "./types";

export default function TechniqueCard({ tech, onStart }: {
  tech: NudgeTechnique; onStart: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{tech.name}</h3>
          {tech.description && <p className="text-sm opacity-80">{tech.description}</p>}
        </div>
        <button onClick={onStart} className="rounded bg-emerald-500 px-3 py-1 text-black">
          開く
        </button>
      </div>
    </div>
  );
}
