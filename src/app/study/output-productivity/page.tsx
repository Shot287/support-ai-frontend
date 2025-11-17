// src/app/study/output-productivity/page.tsx
"use client";

import OutputProductivity from "@/features/study/output-productivity";

export default function OutputProductivityPage() {
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-6">アウトプット管理</h1>
      <OutputProductivity />
    </div>
  );
}
