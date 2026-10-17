import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ALL_FONT_VARIABLES } from "@/lib/fonts";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BECK / PHOTO — Action & High-Resolution Athletics",
  description:
    "Sports action photography by Jaden Beck. Browse recent game galleries and download high-resolution photos.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${ALL_FONT_VARIABLES} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
