// src/app/study/page.tsx
import Link from "next/link";

const cards = [
  {
    id: "dictionary",
    title: "用語辞典",
    description: "科目別の用語を検索・整理（実装は後ほど）",
    href: "/study/dictionary",
  },
] as const;

export default function StudyPage() {
  return (
    <main>
      <h1 className="text-2xl font-bold mb-4">勉強</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.id}
            href={c.href}
            className="block rounded-2xl border p-4 shadow-sm hover:shadow-md transition"
          >
            <h3 className="text-lg font-semibold">{c.title}</h3>
            <p className="text-sm text-gray-600 mt-1">{c.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
