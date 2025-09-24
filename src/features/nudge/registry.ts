import FiveSecondCountdown from "./techniques/five-second";
import type { TechniqueId, TechniqueMeta } from "./types";

// ここは "TECHNIQUES" をエクスポートします（大文字）
export const TECHNIQUES: TechniqueMeta[] = [
  {
    id: "five-second",
    name: "5秒カウントダウン",
    description: "5→0 のカウント後に即開始する起動テクニック",
    Component: FiveSecondCountdown,
  },
];

// id → メタ取得
export function getTechniqueMetaById(id: TechniqueId): TechniqueMeta {
  const found = TECHNIQUES.find((t) => t.id === id);
  if (!found) {
    throw new Error(`Technique not found: ${id}`);
  }
  return found;
}
