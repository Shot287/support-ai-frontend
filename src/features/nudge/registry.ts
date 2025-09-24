// src/features/nudge/registry.ts
import { NudgeTechnique } from "./types";

export const techniques: Array<() => Promise<NudgeTechnique>> = [
  // 追加したいテクニックをここへ
  () => import("./techniques/five-second").then(m => m.default),
  // () => import("./techniques/pomodoro").then(m => m.default),
];

export async function loadAllTechniques() {
  return Promise.all(techniques.map(loader => loader()));
}
