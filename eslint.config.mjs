import { FlatCompat } from "@eslint/eslintrc";
import tseslint from "typescript-eslint";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const webFiles = ["apps/web/**/*.{ts,tsx}"];
const serverAndTestFiles = [
  "apps/api/**/*.ts",
  "apps/worker/**/*.ts",
  "packages/**/*.ts",
  "e2e/**/*.ts",
];

export default [
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/node_modules/**",
      "**/*.generated.*",
      "**/*.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals").map((config) => ({
    ...config,
    files: webFiles,
  })),
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: serverAndTestFiles,
  })),
  {
    files: webFiles,
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
  },
  {
    files: serverAndTestFiles,
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];
