// src/features/nudge/components/TechniqueCard.tsx
import Link from "next/link";
import type { Technique } from "../types";
import type { JSX } from "react";

export function TechniqueCard({ technique }: { technique: Technique }): JSX.Element {
  return (
    <Link
      href={technique.href}
      className="block rounded-2xl border p-4 shadow-sm hover:shadow-md transition"
      aria-label={technique.title}
    >
      <h3 className="text-lg font-semibold">{technique.title}</h3>
      <p className="text-sm text-gray-600 mt-1">{technique.description}</p>
    </Link>
  );
}

export default TechniqueCard;
