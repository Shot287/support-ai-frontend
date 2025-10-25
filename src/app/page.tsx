// src/app/page.tsx
"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { forceSyncAllMaster } from "@/lib/sync";
import { getDeviceId } from "@/lib/device";

const categories = [
  {
    id: "nudge",
    title: "先延ばし対策",
    description: "5秒ルールやポモドーロで初動をつくる",
    href: "/nudge",
  },
  {
    id: "sleep",
    title: "睡眠管理",
    description: "就寝・起床のリズムや振り返り（準備中）",
    href: "/sleep",
  },
  {
    id: "study",
    title: "勉強",
    description: "用語辞典などの学習サポート",
    href: "/study",
  },
  {
    id: "mental",
    title: "Mental",
    description: "メンタルケア・気分管理など（準備中）",
    href: "/mental",
  },
] as const;

export default function HomePage() {
  // 認証導入までの暫定ユーザー
  const userId = "demo";
  const deviceId = getDeviceId();

  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onClickSync = useCallback(async () => {
    try {
      setMessage(null);
      setSyncing(true);
      await forceSyncAllMaster({ userId, deviceId });
      setMessage("この端末の内容で全機能を同期しました。");
    } catch (e: any) {
      setMessage(`同期に失敗しました：${e?.message ?? e}`);
    } finally {
      setSyncing(false);
    }
  }, [userId, deviceId]);

  return (
    <main className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">機能を選んでください</h1>

        <button
          onClick={onClickSync}
          disabled={syncing}
          className="px-3 py-2 rounded-xl border shadow-sm hover:shadow transition disabled:opacity-50"
          title="この端末の内容を正として全機能を同期します"
        >
          {syncing ? "同期中…" : "🔄 この端末で全機能を同期"}
        </button>
      </div>

      {message && (
        <p className="text-sm text-gray-600">{message}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {categories.map((c) => (
          <Link
            key={c.id}
            href={c.href}
            className="block rounded-2xl border p-4 shadow-sm hover:shadow-md transition"
          >
            <h2 className="text-xl font-semibold">{c.title}</h2>
            <p className="text-sm text-gray-600 mt-2">{c.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
