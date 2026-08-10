import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

const webFiles = ["apps/web/**/*.{ts,tsx}"];
const serverAndTestFiles = [
  "apps/api/**/*.ts",
  "apps/worker/**/*.ts",
  "packages/**/*.ts",
  "e2e/**/*.ts",
];
const testFiles = ["**/*.test.ts", "**/*.test.tsx"];

export default [
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/node_modules/**",
      "packages/authjs/**",
      "packages/authjs-core/**",
      "packages/pptxgenjs/**",
      "**/*.generated.*",
      "**/*.d.ts",
    ],
  },
  ...nextCoreWebVitals.map((config) => ({
    ...config,
    files: webFiles,
  })),
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: serverAndTestFiles,
  })),
  {
    files: webFiles,
    rules: {
      // These React compiler diagnostics were introduced by the Next 16 flat
      // preset. Keep the established lint contract while migration work is
      // reviewed separately from this dependency-security change.
      "react-hooks/error-boundaries": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-location-assign-relative-destination": "off",
    },
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
  {
    files: testFiles,
    rules: {
      // Test fixtures intentionally exercise malformed provider and canvas
      // payloads; keep production code strict without forcing unsafe fixture
      // casts through invented application types.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
