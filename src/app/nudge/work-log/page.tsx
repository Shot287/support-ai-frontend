// src/app/nudge/work-log/page.tsx
import WorkLog from "../../../features/nudge/techniques/work-log";

export default function WorkLogPage() {
  return (
    <main className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-4">作業記録（タイムボクシング）</h1>
      <WorkLog />
    </main>
  );
}
