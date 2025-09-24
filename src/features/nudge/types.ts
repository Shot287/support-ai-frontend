// src/features/nudge/types.ts
import { z } from "zod";
import { ComponentType } from "react";

export type TechniqueId = string;

export const BaseSettingsSchema = z.object({}); // 各テクニックが拡張
export type BaseSettings = z.infer<typeof BaseSettingsSchema>;

export interface NudgeTechnique<S extends BaseSettings = BaseSettings> {
  id: TechniqueId;       // "five-second" など
  name: string;          // 表示名
  description?: string;  // 一言説明
  SettingsSchema?: z.ZodType<S>; // 任意（設定UIがある場合）
  Component: ComponentType<{ onDone?: (note?: string) => void }>;
}
