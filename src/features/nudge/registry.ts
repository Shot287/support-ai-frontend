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
];
