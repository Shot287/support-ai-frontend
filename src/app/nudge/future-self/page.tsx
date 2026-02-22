"use client";

import FutureSelf from "@/features/nudge/techniques/future-self";

export default function FutureSelfPage() {
  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-3">大学卒業 時点の自分</h1>
      <p className="text-sm text-gray-600 mb-6 leading-relaxed">
        今の行動は、未来の自分に直結しています。「最高の未来」への期待と、「最悪の現実」への恐怖。
        両方をリアルに書き出すことで、先延ばししている自分に強烈な喝を入れましょう。
      </p>
      <FutureSelf />
    </div>
  );
}