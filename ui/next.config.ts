import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
const minioInternalUrl = process.env.MINIO_INTERNAL_URL || "http://minio:9000";
const minioBucket = process.env.MINIO_BUCKET || "voice-audio";

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverSourceMaps: process.env.NEXT_SERVER_SOURCE_MAPS === "true",
    webpackMemoryOptimizations: true,
  },
  async rewrites() {
    return [
      // Default OSS MinIO bucket proxy. Coolify normally exposes only the UI,
      // so browser-facing MinIO URLs use the same public domain.
      {
        source: `/${minioBucket}/:path*`,
        destination: `${minioInternalUrl}/${minioBucket}/:path*`,
      },
      // API proxy for backend calls (excluding Next.js API routes)
      {
        source: "/api/:path((?!config|auth).*)*",
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
      {
        source: "/ingest/decide",
        destination: "https://us.i.posthog.com/decide",
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
