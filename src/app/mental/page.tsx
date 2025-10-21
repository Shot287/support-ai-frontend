// src/app/mental/page.tsx
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function MentalHome() {
  return (
    <main className="max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Mental</h1>
        <p className="text-gray-600">
          このエリアは準備中です。後ほど機能を追加します。
        </p>
      </header>

      {/* 機能リンク（まずはPC限定の「背筋」だけ有効化） */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/mental/posture"
          className="block rounded-2xl border p-5 hover:shadow-md transition"
        >
          <h2 className="font-semibold">背筋（PCミニウィンドウ）</h2>
          <p className="text-sm text-gray-600 mt-1">
            小ウィンドウで「背筋」リマインダー＆開始/終了タイム計測。
          </p>
        </Link>

        {/* 予備スロット（今後の機能拡張用 / 非表示にしておいてもOK）
        <div className="hidden sm:block rounded-2xl border p-5 opacity-50">
          <h2 className="font-semibold">（準備中）</h2>
          <p className="text-sm text-gray-600 mt-1">今後、機能を追加します。</p>
        </div>
        */}
      </section>

      {/* 記録ページへのショートカット */}
      <p className="text-sm text-gray-500">
        記録を見る：{" "}
        <Link href="/mental/posture/logs" className="text-blue-600 hover:underline">
          背筋の記録
        </Link>
      </p>
    </main>
  );
}
