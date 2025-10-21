/**
 * 今日の終わり（次の0時）のローカル時刻をミリ秒で返す
 */
export function endOfTodayLocalTs(): number {
  const now = new Date();
  // 翌日の 0:00:00.000
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return end.getTime();
}

/**
 * ミリ秒差から Max-Age（秒単位）を算出する
 */
export function msToMaxAge(ms: number): number {
  return Math.max(1, Math.floor(ms / 1000));
}
