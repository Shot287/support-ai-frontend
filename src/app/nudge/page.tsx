// src/app/nudge/page.tsx
import type { Technique } from "../../features/nudge/types";
import { techniques } from "../../features/nudge/registry";
import { TechniqueCard } from "../../features/nudge/components/TechniqueCard";

export default function NudgePage() {
  return (
    <main>
      <h1 className="text-2xl font-bold mb-4">先延ばし対策</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {techniques.map((t: Technique) => (
          <TechniqueCard key={t.id} technique={t} />
        ))}
      </div>
    </main>
  );
}
