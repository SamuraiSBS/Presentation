import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd() + "/../..",
  transpilePackages: ["@studydeck/shared"],
};

export default nextConfig;
