import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Dev server is browsed from this machine's LAN IP (e.g. testing on a
  // phone/another PC). Next 16 blocks cross-origin dev resources — including
  // the HMR socket — unless the origin is allow-listed, which silently stops
  // React from hydrating (buttons render but never respond).
  allowedDevOrigins: ["192.168.18.79"],
  partialPrefetching: true,
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
