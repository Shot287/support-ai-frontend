"use client";

import type { JSX } from "react"; // ← 追加
import type {
  TechniqueMeta,
  TechniqueResult,
  TechniqueComponentProps,
} from "./types";

type Props = {
  meta: TechniqueMeta;
  onComplete: (r: TechniqueResult) => void;
  onCancel: () => void;
  onError?: (msg: string) => void;
};

export default function TechniqueCard({
  meta,
  onComplete,
  onCancel,
  onError,
}: Props) {
  const Component = meta.Component as (p: TechniqueComponentProps) => JSX.Element; // ← ここで JSX.Element
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/15 p-4">
      <div className="mb-3">
        <div className="font-semibold">{meta.name}</div>
        <div className="text-sm opacity-70">{meta.description}</div>
      </div>
      <Component onComplete={onComplete} onCancel={onCancel} onError={onError} />
    </div>
  );
}
