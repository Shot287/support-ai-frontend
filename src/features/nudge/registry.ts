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
    id: "tournament",
    title: "トーナメント方式",
    description: "二択の勝ち上がりで優先順位を自動決定（同率は再戦）",
    href: "/nudge/tournament",
  },
];
