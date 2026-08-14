import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

const webRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(webRoot, "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    // The Next package and the lockfile live at the monorepo root. Without
    // this, Turbopack treats apps/web as the filesystem root on Windows and
    // cannot resolve next/package.json from the workspace installation.
    root: workspaceRoot,
    // Keep the web app on the shared package's built ESM entry. Resolving its
    // declaration-only TypeScript path in Turbopack leaves runtime exports
    // undefined during instrumentation loading.
    resolveAlias: {
      "@studydeck/shared": "../../packages/shared/dist/index.js",
    },
  },
  // npm workspace scripts can preserve the repository as process.cwd().
  // Derive from this config file instead, otherwise `../..` resolves to D:\\
  // on Windows and Watchpack scans the entire drive during local E2E.
  outputFileTracingRoot: process.env.E2E_TEST_MODE === "true" ? webRoot : workspaceRoot,
  // `@studydeck/shared` is built to its ESM entry point before the web build.
  // Let Next resolve that entry point directly: transpiling this workspace in
  // Turbopack 16 can turn runtime re-exports into undefined during page-data
  // collection.
};

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
