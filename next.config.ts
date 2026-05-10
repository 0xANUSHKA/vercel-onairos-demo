import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  transpilePackages: ["three", "onairos"],
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "react$": require.resolve("react"),
      "react-dom$": require.resolve("react-dom"),
    };
    return config;
  },
};

export default nextConfig;
