// src/app/page.tsx
import Link from "next/link";

const categories = [
  {
    id: "nudge",
    title: "先延ばし対策",
    description: "5秒ルールやポモドーロで初動をつくる",
    href: "/nudge",
  },
  {
    id: "sleep",
    title: "睡眠管理",
    description: "就寝・起床のリズムや振り返り（準備中）",
    href: "/sleep",
  },
  {
    id: "study",
    title: "勉強",
    description: "用語辞典などの学習サポート",
    href: "/study",
  },
] as const;

export default function HomePage() {
  return (
    <main>
      <h1 className="text-2xl font-bold mb-4">機能を選んでください</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {categories.map((c) => (
          <Link
            key={c.id}
            href={c.href}
            className="block rounded-2xl border p-4 shadow-sm hover:shadow-md transition"
          >
            <h2 className="text-xl font-semibold">{c.title}</h2>
            <p className="text-sm text-gray-600 mt-2">{c.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
