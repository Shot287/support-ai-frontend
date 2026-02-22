// src/features/nudge/registry.ts
import type { Technique } from "./types";
import { fiveMinutePing } from "./techniques/fiveMinutePing"; // ← 追加

export const techniques: Technique[] = [
  // =========================
  // 上位（使用頻度 高）
  // =========================
  {
    id: "five-second",
    title: "5秒カウントダウン",
    description: "5→1で迷いを断ち切って即行動！",
    href: "/nudge/five-second",
  },
  {
    id: "self-talk",
    title: "セルフトーク",
    description: "1ページ1フレーズ。編集＆複数セット保存に対応",
    href: "/nudge/self-talk",
  },
  {
    id: "visualize",
    title: "デイリーメトリクス",
    description: "試験名と試験日を登録して、当日までの残り日数を見える化",
    href: "/nudge/visualize",
  },
  {
    id: "process-goals",
    title: "プロセスの目標",
    description: "勉強時間・睡眠時間などを項目別に1ヶ月分記録・管理",
    href: "/nudge/process-goals",
  },
  {
    id: "minimum-quota",
    title: "最低ノルマ",
    description: "1日ごとに複数ノルマを設定し、夜に○/×で達成チェック",
    href: "/nudge/minimum-quota",
  },

  // =========================
  // ここで「距離」を空ける（スペーサー）
  // ※ UI 側を触れない前提で、空のカードを挟んで余白を作る
  // =========================
  {
    id: "__spacer__1",
    title: "　", // 全角スペース（空表示）
    description: "",
    href: "#",
  },
  {
    id: "__spacer__2",
    title: "　",
    description: "",
    href: "#",
  },

  // =========================
  // 下位（使用頻度 低）
  // =========================
  {
    id: "pomodoro",
    title: "ポモドーロ",
    description: "25分集中＋5分休憩で生産性アップ",
    href: "/nudge/pomodoro",
  },
  {
    id: "round-robin",
    title: "総当たり方式",
    description: "全ペアを比較して完全な優先順位を作成",
    href: "/nudge/round-robin",
  },
  {
    id: "work-log",
    title: "作業記録（タイムボクシング）",
    description: "カード単位で開始/終了を記録し、日別の時間ブロックで可視化",
    href: "/nudge/work-log",
  },
  {
    id: "plan-timeboxing",
    title: "計画（タイムボクシング）",
    description: "作業記録のカードをもとに、今日の予定を立てる",
    href: "/nudge/plan",
  },
  {
    id: "todo",
    title: "ToDoリスト",
    description: "締め切りと残り日数を表示。完了→削除可。ローカルに永久保存",
    href: "/nudge/todo",
  },
  {
    id: "checklist",
    title: "チェックリスト",
    description: "1ページ=1行動。開始/終了で所要時間、間は先延ばし時間を自動記録",
    href: "/nudge/checklist",
  },
  {
    id: "checklist-logs",
    title: "チェックリスト記録参照",
    description: "カレンダーで日付指定。各行動＋直前先延ばしを1セットで表示",
    href: "/nudge/checklist/logs",
  },
  {
    id: "reflection-note",
    title: "反省ノート",
    description: "カレンダーで日付を選んで、その日の反省を1枚のノートに書き出す",
    href: "/nudge/reflection-note",
  },
  {
    id: "peer-pressure",
    title: "ピアプレッシャー",
    description: "誰かに見られているつもりで、今からやることを宣言するノート",
    href: "/nudge/peer-pressure",
  },
  {
    id: "future-self",
    title: "大学卒業 時点の自分",
    description: "目標達成時の最高の未来と、失敗した時の最悪の現実を描き出す",
    href: "/nudge/future-self",
  },

  // ⭐ 既存維持
  fiveMinutePing,
];
