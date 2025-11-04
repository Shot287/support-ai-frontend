// src/app/study/dev-plan/page.tsx
import { DevPlan } from "@/features/study/DevPlan";

export const dynamic = "force-dynamic";

export default function DevPlanPage() {
  return (
    <main className="max-w-5xl mx-auto space-y-4">
      <header>
        <h1 className="text-2xl font-bold">開発計画</h1>
        <p className="text-gray-600 text-sm">
          フォルダーごとにノートを作成し、タイトルクリックで詳細ページへ移動します。
        </p>
      </header>
      <DevPlan />
    </main>
  );
}
