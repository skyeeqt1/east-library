import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/*
 * Inter (400/500/600/700) self-hosted via next/font — design §2.2 / §8.
 * The `--font-inter` custom property is consumed by `--font-sans` in
 * app/globals.css (design tokens).
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ESCR Library",
    template: "%s · ESCR Library",
  },
  description:
    "East Systems Colleges of Rizal Library Management System — browse, request, and track books.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
