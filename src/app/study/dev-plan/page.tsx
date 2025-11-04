// src/app/study/dev-plan/page.tsx
import { DevPlan } from "@/features/study/DevPlan";

export const dynamic = "force-dynamic";

export default function DevPlanPage() {
  return (
    <main className="max-w-5xl mx-auto space-y-4">
      <header>
        <h1 className="text-2xl font-bold">開発計画</h1>
        <p className="text-gray-600 text-sm">
          各フォルダーごとに機能ノートを作り、小ノート（課題点／計画など）を追加・編集できます。
        </p>
      </header>
      <DevPlan />
    </main>
  );
}
