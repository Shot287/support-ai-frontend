// src/app/page.tsx
"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { getDeviceId } from "@/lib/device";
import { emitGlobalPull, emitGlobalPush } from "@/lib/sync-bus";
import { loadUserDoc, saveUserDoc } from "@/lib/userDocStore";

// 手動同期の対象ドキュメント一覧（必要に応じて追加）
const DOCS = [
  { docKey: "study_dictionary_v1", localKey: "dictionary_v2" },
  { docKey: "study_python_dictionary_v1", localKey: "python_dictionary_v2" },
  { docKey: "devplan_v1",          localKey: "devplan_v1" }, // ← 追加！
  { docKey: "output_productivity_v1", localKey: "output_productivity_v1" },
  { docKey: "code_reading_v1",        localKey: "code_reading_v1" },
  { docKey: "mental_expressive_writing_v1", localKey: "expressive_writing_v1" },
  { docKey: "mental_vas_v1", localKey: "mental_vas_v1" },
  { docKey: "mental_defusion_v1", localKey: "mental_defusion_v1" },
  { docKey: "mental_loving_kindness_v1",  localKey: "loving_kindness_v1" },
  { docKey: "math_logic_expansion_v1", localKey: "math_logic_expansion_v1" },
  { docKey: "study_sapuri_words_v1", localKey: "study_sapuri_words_v1" },
  { docKey: "process_goals_v1", localKey: "process_goals_v1" },
  { docKey: "reflection_note_v1", localKey: "reflection_note_v1" },
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
    if (typeof err === "object" && err !== null) return JSON.stringify(err, null, 2);
    return String(err);
  } catch {
    return "不明なエラー（formatErrorDetail失敗）";
  }
}

// localStorage へ書き込み
function writeLocal(localKey: string, json: unknown) {
  try {
    localStorage.setItem(localKey, JSON.stringify(json));
  } catch {}
}

// 「ローカルへ反映したよ」という合図（辞書/DevPlanなどが開いていれば即時更新できる）
const SYNC_CHANNEL = "support-ai-sync";
function notifyLocalApplied(docKey: string) {
  const payload = { type: "LOCAL_DOC_APPLIED", docKey, at: Date.now() } as const;
  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel(SYNC_CHANNEL);
      bc.postMessage(payload);
      bc.close();
    }
  } catch {}
  try {
    window.postMessage(payload, "*");
  } catch {}
}

export default function HomePage() {
  // 暫定ユーザー（認証導入まで）
  const userId = "demo";
  const deviceId = getDeviceId();

  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 📥 取得（クラウド → ローカル）
  const onClickPullAll = useCallback(async () => {
    setMessage(null);
    setBusy("pull");
    try {
      // 互換のため、各機能への合図も投げる
      emitGlobalPull(userId, deviceId);

      // ホーム側で直接 Pull を実行（機能画面が開いていなくても反映）
      for (const { docKey, localKey } of DOCS) {
        const remote = await loadUserDoc<any>(docKey);
        if (remote) {
          writeLocal(localKey, remote);
          notifyLocalApplied(docKey);
        }
      }

      alert(
        [
          "📥 取得（受信）が完了しました。（サーバ → 端末）",
          `userId: ${userId}`,
          `deviceId: ${deviceId}`,
          `at: ${new Date().toLocaleString()}`,
        ].join("\n")
      );
      setMessage("取得が完了しました。開いている画面は自動で最新に反映されます。");
    } catch (e) {
      const detail = formatErrorDetail(e);
      alert(["📥 取得（受信）でエラーが発生しました。", detail].join("\n\n"));
      setMessage(`取得要求に失敗しました：${detail}`);
    } finally {
      setBusy(null);
    }
  }, [userId, deviceId]);

  // ☁ アップロード（ローカル → クラウド）
  const onClickPushAll = useCallback(async () => {
    setMessage(null);
    setBusy("push");
    try {
      // 互換のため、各機能への合図も投げる
      emitGlobalPush(userId, deviceId);

      // ホーム側で直接 Push を実行
      for (const { docKey, localKey } of DOCS) {
        const raw = localStorage.getItem(localKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        await saveUserDoc(docKey, parsed);
      }

      alert(
        [
          "☁ アップロードが完了しました。（端末 → サーバ）",
          `userId: ${userId}`,
          `deviceId: ${deviceId}`,
          `at: ${new Date().toLocaleString()}`,
        ].join("\n")
      );
      setMessage("アップロードが完了しました。別端末では『取得』を押すと反映されます。");
    } catch (e) {
      const detail = formatErrorDetail(e);
      alert(["☁ アップロードでエラーが発生しました。", detail].join("\n\n"));
      setMessage(`アップロード要求に失敗しました：${detail}`);
    } finally {
      setBusy(null);
    }
  }, [userId, deviceId]);

  const categories = [
    { id: "nudge",  title: "先延ばし対策", description: "5秒ルールやポモドーロで初動をつくる", href: "/nudge" },
    { id: "sleep",  title: "睡眠管理",     description: "就寝・起床のリズムや振り返り（準備中）", href: "/sleep" },
    { id: "study",  title: "勉強",         description: "用語辞典などの学習サポート", href: "/study" },
    { id: "mental", title: "M",       description: "修行", href: "/mental" },
  ] as const;

  return (
    <main className="p-4 space-y-4">
      {/* タイトルとボタン群 */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">機能を選んでください</h1>

        <div className="flex gap-2">
          {/* 📥 取得ボタン */}
          <button
            onClick={onClickPullAll}
            disabled={busy !== null}
            className="px-3 py-2 rounded-xl border shadow-sm hover:shadow transition disabled:opacity-50"
            title="サーバ上の最新データを受信し、localStorageへ反映します"
          >
            {busy === "pull" ? "取得中…" : "📥 取得"}
          </button>

          {/* ☁ アップロードボタン */}
          <button
            onClick={onClickPushAll}
            disabled={busy !== null}
            className="px-3 py-2 rounded-xl border shadow-sm hover:shadow transition disabled:opacity-50"
            title="localStorageの変更をサーバーにアップロードします"
          >
            {busy === "push" ? "アップロード中…" : "☁ アップロード"}
          </button>
        </div>
      </div>

      {/* メッセージ表示 */}
      {message && <p className="text-sm text-gray-600 whitespace-pre-wrap">{message}</p>}

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
