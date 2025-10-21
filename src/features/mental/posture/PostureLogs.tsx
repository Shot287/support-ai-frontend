"use client";
import { useEffect, useMemo, useState } from "react";
import { loadRecords, fmtDate, fmtClock, fmtDur } from "./storage";

export default function PostureLogs() {
  const [rows, setRows] = useState(loadRecords());

  useEffect(() => { setRows(loadRecords()); }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = fmtDate(r.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  const clearAll = () => {
    if (!confirm("すべての記録を削除します。よろしいですか？")) return;
    localStorage.removeItem("posture_records_v1");
    setRows([]);
  };

  return (
    <main className="max-w-3xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">背筋の記録</h1>
          <p className="text-gray-600 text-sm">開始時刻・終了時刻・タイム（分:秒）を日付ごとに表示します。</p>
        </div>
        <button onClick={clearAll} className="rounded-xl border px-3 py-1 text-sm">すべて削除</button>
      </header>

      {grouped.length === 0 ? (
        <p className="text-gray-500">まだ記録がありません。</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([date, list]) => (
            <section key={date} className="rounded-2xl border p-5">
              <h2 className="font-semibold">{date}</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-600">
                    <tr>
                      <th className="text-left py-2">開始時刻</th>
                      <th className="text-left py-2">終了時刻</th>
                      <th className="text-left py-2">タイム</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="py-2">{fmtClock(r.start)}</td>
                        <td className="py-2">{fmtClock(r.end)}</td>
                        <td className="py-2 font-mono">{fmtDur(r.durationSec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
