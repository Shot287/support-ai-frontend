import { mentalTools } from "@/features/mental/registry";
import MentalCard from "@/features/mental/components/MentalCard";

export const dynamic = "force-dynamic";

export default function MentalHome() {
  return (
    <main className="max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Mental</h1>
        <p className="text-gray-600">
          メンタルケア系のツール集です。必要なものから使い始めましょう。
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {mentalTools.map((t) => (
          <MentalCard key={t.id} tool={t} />
        ))}
      </section>
    </main>
  );
}
