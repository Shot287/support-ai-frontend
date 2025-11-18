// src/app/study/sapuri-wordbook/page.tsx
"use client";

import SapuriWordbook from "@/features/study/sapuri-wordbook";

export default function SapuriWordbookPage() {
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-6">スタディサプリ対応英単語帳</h1>
      <SapuriWordbook />
    </div>
  );
}
