import type { Metadata } from "next";
import { DM_Mono, Inter, Syne } from "next/font/google";
import { GameToaster } from "../components/system/game-toaster";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Spin Battle",
  description:
    "Spin Battle rooms with wallet-backed entries and live betting activity.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${syne.variable} ${dmMono.variable}`}>
        {children}
        <GameToaster />
      </body>
    </html>
  );
}
