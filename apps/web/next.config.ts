import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    // Proxy /api-backend/* → API service so a single ngrok tunnel covers both web + API
    const apiUrl = process.env.API_INTERNAL_URL || "http://api:3000";
    return [
      {
        source: "/api-backend/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
