// src/app/study/instagram-follow-manager/page.tsx
"use client";

import InstagramFollowManager from "@/features/study/instagram-follow-manager";

export default function InstagramFollowManagerPage() {
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-6">Instagram相互フォロー管理</h1>
      <InstagramFollowManager />
    </div>
  );
}
