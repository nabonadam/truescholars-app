import type { NextConfig } from "next";

/** Sent with every page and file: they tell browsers to refuse common attacks. */
const SECURITY_HEADERS = [
  // never inside another site's frame (stops click-jacking); no plugins; <base> can't be hijacked
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // HTTPS only, for a year
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // the microphone is for survey answers and question explanations; nothing else is allowed
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Loaded by Node directly (not bundled): the PDF reader ships its own worker and module tricks.
  serverExternalPackages: ["unpdf"],
  experimental: {
    // Deliveries and message attachments: up to 5 files of 10 MB each.
    serverActions: { bodySizeLimit: "52mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
