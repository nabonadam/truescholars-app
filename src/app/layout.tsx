import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: { default: "The True Scholars", template: "%s · The True Scholars" },
  description: "Vetted academic experts and AI research tools you can trust.",
};

export const viewport: Viewport = { themeColor: "#0f3d2a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap"
        />
        <link rel="icon" href="https://thetruescholars.com/wp-content/uploads/2026/11/true-scholars-icon-150x150.png" />
      </head>
      <body className="min-h-dvh bg-parchment">
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}
