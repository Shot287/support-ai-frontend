// src/features/nudge/registry.ts
import type { Technique } from "./types";

export const techniques: Technique[] = [
  {
    id: "five-second",
    title: "5秒カウントダウン",
    description: "5→1で迷いを断ち切って即行動！",
    href: "/nudge/five-second",
  },
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
    id: "visualize",
    title: "ビジュアライズ",
    description: "試験名と試験日を登録して、当日までの残り日数を見える化",
    href: "/nudge/visualize",
  },
  {
    id: "self-talk",
    title: "セルフトーク",
    description: "1ページ1フレーズ。編集＆複数セット保存に対応",
    href: "/nudge/self-talk",
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
    id: "process-goals",
    title: "プロセスの目標",
    description: "勉強時間・睡眠時間などを項目別に1ヶ月分記録・管理",
    href: "/nudge/process-goals",
  },
];
