// src/features/study/kana.ts
import { toHiragana } from "wanakana";

/** 検索用キーへ正規化
 * - lowerCase
 * - NFKC 正規化（全角/半角のゆれ吸収）
 * - ひらがな化（カタカナ→ひらがな、英字/ローマ字は toHiragana が可能な範囲でかな化）
 */
export function toSearchKey(input: string): string {
  const base = input.toLowerCase().normalize("NFKC");
  return toHiragana(base);
}
