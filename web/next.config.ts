import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Pin turbopack root to the monorepo root so a parent-directory lockfile
// (e.g. ~/pnpm-lock.yaml) is not mistaken for the workspace root, while
// still resolving the hoisted `next` package under the workspace root.
const appDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(appDir, "..");

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: monorepoRoot,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "linux.do",
      },
      {
        protocol: "https",
        hostname: "g.alicdn.com",
      },
      {
        protocol: "https",
        hostname: "watcha.tos-cn-beijing.volces.com",
      },
    ],
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
