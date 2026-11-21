import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server (.next/standalone) for the Docker image; Vercel
  // ignores this and uses its own output.
  output: "standalone",
  async headers() {
    return [
      {
        // The live-preview runtime (public/preview-runtime): public, pinned
        // library files. The preview frame has an opaque origin, and module
        // scripts (import / import maps) are always fetched with CORS, so they
        // need this header to load; classic <script src> doesn't.
        source: "/preview-runtime/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
