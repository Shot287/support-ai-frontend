"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { MentalTool } from "../registry";

export default function MentalCard({ tool }: { tool: MentalTool }) {
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    if (!tool.desktopOnly) return; // PC限定チェックだけ行う
    const wide = window.matchMedia("(min-width: 768px)").matches;
    const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setIsDesktop(wide && !touch);
  }, [tool.desktopOnly]);

  return (
    <Link
      href={tool.href}
      className={`block rounded-2xl border p-5 hover:shadow-md transition ${tool.desktopOnly && !isDesktop ? "pointer-events-none opacity-50" : ""}`}
      title={tool.desktopOnly && !isDesktop ? "PC環境でご利用ください" : ""}
    >
      <h2 className="font-semibold">{tool.title}</h2>
      <p className="text-sm text-gray-600 mt-1">{tool.description}</p>
      {tool.desktopOnly && (
        <p className="text-xs text-gray-500 mt-2">※PC限定</p>
      )}
    </Link>
  );
}
