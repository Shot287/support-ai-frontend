// src/app/page.tsx
"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { getDeviceId } from "@/lib/device";
import { emitGlobalPull, emitGlobalPush } from "@/lib/sync-bus";

const categories = [
  { id: "nudge",  title: "先延ばし対策", description: "5秒ルールやポモドーロで初動をつくる", href: "/nudge" },
  { id: "sleep",  title: "睡眠管理",     description: "就寝・起床のリズムや振り返り（準備中）", href: "/sleep" },
  { id: "study",  title: "勉強",         description: "用語辞典などの学習サポート", href: "/study" },
  { id: "mental", title: "Mental",       description: "メンタルケア・気分管理など（準備中）", href: "/mental" },
] as const;

// エラー表示用：できるだけ詳細に
function formatErrorDetail(err: unknown) {
  try {
    if (err instanceof Error) {
      return [
        `name: ${err.name}`,
        `message: ${err.message}`,
        err.stack ? `stack:\n${err.stack}` : "",
      ].filter(Boolean).join("\n");
    }
    if (typeof err === "object" && err !== null) {
      return JSON.stringify(err, null, 2);
    }
    return String(err);
  } catch {
    return "不明なエラー（formatErrorDetail失敗）";
  }
}

export default function HomePage() {
  // 暫定ユーザー（認証導入まで）
  const userId = "demo";
  const deviceId = getDeviceId();

  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 🔄 受信（クラウド → ローカル）
  const onClickPullAll = useCallback(() => {
    setMessage(null);
    setBusy("pull");
    try {
      emitGlobalPull(userId, deviceId);

      // --- アラートで即時フィードバック（成功）
      alert(
        [
          "🔄 同期（受信）リクエストを送信しました。",
          `userId: ${userId}`,
          `deviceId: ${deviceId}`,
          `at: ${new Date().toLocaleString()}`,
        ].join("\n")
      );

      setMessage("全機能に“受信（同期）”要求を送りました。各画面が最新化されます。");
    } catch (e) {
      const detail = formatErrorDetail(e);
      alert(["🔄 同期（受信）でエラーが発生しました。", detail].join("\n\n"));
      setMessage(`受信要求に失敗しました：${detail}`);
    } finally {
      setBusy(null);
    }
  }, [userId, deviceId]);

  // ☁ 手動アップロード（ローカル → クラウド）
  const onClickPushAll = useCallback(() => {
    setMessage(null);
    setBusy("push");
    try {
      emitGlobalPush(userId, deviceId);

      // --- アラートで即時フィードバック（成功）
      alert(
        [
          "☁ 手動アップロード要求を送信しました。",
          `userId: ${userId}`,
          `deviceId: ${deviceId}`,
          `at: ${new Date().toLocaleString()}`,
        ].join("\n")
      );

      setMessage("全機能に“手動アップロード”要求を送りました。ローカルの変更をクラウドに保存します。");
    } catch (e) {
      const detail = formatErrorDetail(e);
      alert(["☁ 手動アップロードでエラーが発生しました。", detail].join("\n\n"));
      setMessage(`アップロード要求に失敗しました：${detail}`);
    } finally {
      setBusy(null);
    }
  }, [userId, deviceId]);

  return (
    <main className="p-4 space-y-4">
      {/* タイトルとボタン群 */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">機能を選んでください</h1>

        <div className="flex gap-2">
          {/* 🔄 受信ボタン */}
          <button
            onClick={onClickPullAll}
            disabled={busy !== null}
            className="px-3 py-2 rounded-xl border shadow-sm hover:shadow transition disabled:opacity-50"
            title="サーバ上の最新データを受信し、全機能を更新します"
          >
            {busy === "pull" ? "受信中…" : "🔄 同期（受信）"}
          </button>

          {/* ☁ 手動アップロードボタン */}
          <button
            onClick={onClickPushAll}
            disabled={busy !== null}
            className="px-3 py-2 rounded-xl border shadow-sm hover:shadow transition disabled:opacity-50"
            title="ローカルの変更をクラウドにアップロードします"
          >
            {busy === "push" ? "アップロード中…" : "☁ 手動アップロード"}
          </button>
        </div>
      </div>

      {/* メッセージ表示 */}
      {message && <p className="text-sm text-gray-600">{message}</p>}

      {/* 機能カテゴリ一覧 */}
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
