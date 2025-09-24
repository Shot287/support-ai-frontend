// 追加
import type { JSX } from "react";

export type TechniqueId = "five-second";

export type TechniqueResult = {
  techniqueId: TechniqueId;
  success: boolean;
  durationMs?: number;
  notes?: string;
};

export type TechniqueComponentProps = {
  onComplete: (result: TechniqueResult) => void;
  onCancel: () => void;
  onError?: (msg: string) => void;
};

export type TechniqueMeta = {
  id: TechniqueId;
  name: string;
  description: string;
  Component: (props: TechniqueComponentProps) => JSX.Element; // ← JSX を使用
};
