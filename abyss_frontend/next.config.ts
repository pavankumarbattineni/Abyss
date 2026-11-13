import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server (.next/standalone) for the Docker image; Vercel
  // ignores this and uses its own output.
  output: "standalone",
};

export default nextConfig;
