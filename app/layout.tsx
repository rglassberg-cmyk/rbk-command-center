import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import AuthProvider from "./components/AuthProvider";
import ImpersonationBanner from "./components/ImpersonationBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const sourceSerif4 = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "Command Center by Lhasa",
  description: "Operations dashboard by Lhasa",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Command Center by Lhasa",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1B3A6B",
  // Intentionally NOT setting maximumScale / userScalable — those block
  // pinch-to-zoom and violate WCAG 2.1 1.4.4 (resize text).
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* apple-mobile-web-app-capable, status-bar-style, and title are
            emitted by the `appleWebApp` metadata block above; the apple-touch-icon
            is the only manual tag still needed because Next's metadata field
            for it points to a fixed-name icon path we don't use. */}
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif4.variable} antialiased`}
      >
        <AuthProvider>
          <ImpersonationBanner />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
