// src/app/nudge/round-robin/page.tsx
import RoundRobin from "../../../features/nudge/techniques/round-robin";

export default function RoundRobinPage() {
  return (
    <main className="max-w-xl">
      <h1 className="text-2xl font-bold mb-4">総当たり方式</h1>
      <RoundRobin />
    </main>
  );
}
