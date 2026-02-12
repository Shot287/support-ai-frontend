// src/app/nudge/minimum-quota/page.tsx
"use client";

import MinimumQuota from "@/features/nudge/techniques/minimum-quota";

export default function MinimumQuotaPage() {
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-3">最低ノルマ</h1>
      <p className="text-sm text-gray-600 mb-4 leading-relaxed">
        1日あたり複数の「最低ノルマ」を設定し、1日の終わりに○/×で達成チェックします。
        目的は“ゼロを防ぐ”こと。小さくても続けられる行動を置いてください。
      </p>
      <MinimumQuota />
    </div>
  );
}
