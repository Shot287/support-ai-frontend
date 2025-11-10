// src/app/nudge/process-goals/page.tsx
"use client";

import ProcessGoals from "@/features/nudge/techniques/process-goals";

export default function ProcessGoalsPage() {
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-6">プロセスの目標</h1>
      <ProcessGoals />
    </div>
  );
}
