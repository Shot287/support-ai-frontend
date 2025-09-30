// src/app/nudge/tournament/page.tsx
import Tournament from "../../../features/nudge/techniques/tournament";

export default function TournamentPage() {
  return (
    <main className="max-w-xl">
      <h1 className="text-2xl font-bold mb-4">トーナメント方式</h1>
      <Tournament />
    </main>
  );
}
