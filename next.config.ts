import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["onairos"],
  experimental: {
    webpackBuildWorker: process.env.NEXT_DEBUG_BUILD_WORKER === "0" ? false : undefined,
  },
};

export default nextConfig;
