import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  poweredByHeader: false,
  images: { formats: ["image/avif", "image/webp"] },
  // With the gateway configured, browser API calls are forwarded by the edge
  // network (no function runs, nothing is billed as compute). Checked before the
  // route handler, which stays for local runs that talk to FastAPI directly.
  async rewrites() {
    const api = process.env.ODLAR_API_URL?.replace(/\/$/, "");
    return { beforeFiles: api ? [{ source: "/api/v1/:path*", destination: `${api}/:path*` }] : [] };
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
