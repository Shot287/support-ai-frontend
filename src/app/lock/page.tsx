'use client';
import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function LockForm() {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const params = useSearchParams();
  const router = useRouter();
  const nextPath = params.get('next') || '/';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      credentials: 'include',
    });
    if (res.ok) {
      router.replace(nextPath);
    } else {
      const j = await res.json().catch(() => ({}));
      setErr(j?.message ?? 'パスワードが違います。');
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm space-y-4 border rounded-2xl p-6 shadow"
    >
      <h1 className="text-xl font-bold">Support-AI ロック解除</h1>
      <input
        type="password"
        className="w-full border rounded px-3 py-2"
        placeholder="パスワード"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
      />
      {err && <p className="text-red-600 text-sm">{err}</p>}
      <button
        type="submit"
        className="w-full rounded-xl px-4 py-2 bg-black text-white"
      >
        入室
      </button>
    </form>
  );
}

export default function LockPage() {
  // ✅ useSearchParams を Suspense で包む
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Suspense fallback={<div>読み込み中...</div>}>
        <LockForm />
      </Suspense>
    </main>
  );
}
