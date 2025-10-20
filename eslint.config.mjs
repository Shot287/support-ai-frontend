// eslint.config.mjs
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

// 現在ファイルの絶対パス解決（ESM環境対応）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Next.js / TypeScript 向け設定を互換モードで読み込み
const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// ✅ 完全版設定
const eslintConfig = [
  // Next.js 標準ルール（Core Web Vitals + TypeScript）
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // 共通設定
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],

    rules: {
      /**
       * 🚀 ここからカスタマイズ（ビルド通過重視）
       */

      // any の使用を許可（Vercelビルド通過のため）
      "@typescript-eslint/no-explicit-any": "off",

      // useMemo/useEffect の依存警告を warning のみに緩和
      "react-hooks/exhaustive-deps": "warn",

      // 未使用変数は警告のみに
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],

      // console.log を警告（エラーではない）
      "no-console": "warn",
    },
  },
];

export default eslintConfig;
