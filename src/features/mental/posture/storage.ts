export type PostureRecord = { start: number; end: number; durationSec: number };
const KEY = "posture_records_v1";

export function loadRecords(): PostureRecord[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function saveRecords(rows: PostureRecord[]) {
  localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 500)));
}
export function addRecord(r: PostureRecord) {
  const rows = loadRecords();
  rows.unshift(r);
  saveRecords(rows);
}
export const fmtClock = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const fmtDate = (ts: number) => new Date(ts).toLocaleDateString();
export const fmtDur = (sec: number) =>
  `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
