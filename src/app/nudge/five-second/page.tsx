// src/app/nudge/five-second/page.tsx
import FiveSecond from "../../../features/nudge/techniques/five-second";

export default function FiveSecondPage() {
  return (
    <main className="max-w-xl">
      <h1 className="text-2xl font-bold mb-4">5秒カウントダウン</h1>
      <FiveSecond />
    </main>
  );
}
