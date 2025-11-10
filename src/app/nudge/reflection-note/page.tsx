// src/app/nudge/reflection-note/page.tsx
"use client";

import ReflectionNote from "@/features/nudge/techniques/reflection-note";

export default function ReflectionNotePage() {
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-3">反省ノート</h1>
      <p className="text-sm text-gray-600 mb-4 leading-relaxed">
        カレンダーで日付を選び、その日の先延ばしやうまくいかなかった点、うまくいった点、
        明日から変えてみることなどを1枚のノートとして書き残せます。
        同じ日付を選べば、いつでも書き直し・追記ができます。
      </p>
      <ReflectionNote />
    </div>
  );
}
