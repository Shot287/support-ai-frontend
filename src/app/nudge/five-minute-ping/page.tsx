// src/app/nudge/five-minute-ping/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import SubscribeControl from "@/features/push/SubscribeControl";

const STORAGE_KEY = "nudge_five_minute_ping_enabled_v1";

export default function FiveMinutePingPage() {
  const [enabled, setEnabled] = useState(false);

  // 初期ロード（ローカル保存）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      setEnabled(raw === "1");
    } catch {}
  }, []);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {}
  };

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-bold">5分ごと通知</h1>

      <p className="text-sm text-gray-600">
        SNSに没頭して勉強が頭から抜け落ちたときに、5分ごとに通知で意識を戻します。
        （まずは端末登録 → ON/OFFまでを作ります）
      </p>

      {/* ① 端末をPush購読（既存資産をそのまま使う） */}
      <SubscribeControl />

      {/* ② ON/OFF */}
      <div className="rounded-xl border p-4 space-y-2">
        <div className="font-semibold">5分通知の状態</div>
        <div className="text-sm text-gray-600">
          現在：{enabled ? "✅ ON（送信対象）" : "⛔ OFF（送信しない）"}
        </div>

        <button
          onClick={toggle}
          className="rounded-xl bg-black px-5 py-2 text-white hover:opacity-90"
        >
          {enabled ? "OFFにする" : "ONにする"}
        </button>

        <div className="text-xs text-gray-500">
          ※この段階ではローカル保存です。次のステップでサーバ保存＋5分Cronに接続します。
        </div>
      </div>
    </main>
  );
}
