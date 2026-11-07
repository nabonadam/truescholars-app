import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Loaded by Node directly (not bundled): the PDF reader ships its own worker and module tricks.
  serverExternalPackages: ["unpdf"],
  experimental: {
    // Deliveries and message attachments: up to 5 files of 10 MB each.
    serverActions: { bodySizeLimit: "52mb" },
  },
};

export default nextConfig;
