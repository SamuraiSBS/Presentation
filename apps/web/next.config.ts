import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

const webRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(webRoot, "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  // npm workspace scripts can preserve the repository as process.cwd().
  // Derive from this config file instead, otherwise `../..` resolves to D:\\
  // on Windows and Watchpack scans the entire drive during local E2E.
  outputFileTracingRoot: process.env.E2E_TEST_MODE === "true" ? webRoot : workspaceRoot,
  transpilePackages: ["@studydeck/shared"],
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
