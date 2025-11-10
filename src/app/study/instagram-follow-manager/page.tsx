// src/app/study/instagram-follow-manager/page.tsx
"use client";

import InstagramFollowManager from "@/features/study/instagram-follow-manager";

export default function InstagramFollowManagerPage() {
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-6">Instagram相互フォロー管理</h1>
      <p className="text-sm text-gray-600 mb-4">
        フォローしているアカウントを登録して、相互フォローかどうかを管理するツールです。
        差分リストを見ながら、Instagram 側でフォロー解除する前提の「整理専用ノート」だと思ってください。
      </p>
      <InstagramFollowManager />
    </div>
  );
}
