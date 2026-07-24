import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  output: "standalone",
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
