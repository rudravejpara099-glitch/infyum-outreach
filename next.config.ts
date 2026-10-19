import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal app with live data: every page renders fresh, so caching modes stay off.
  // better-sqlite3 is a native module and must not be bundled.
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
