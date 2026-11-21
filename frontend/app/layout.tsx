import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/ui";
import { LangProvider } from "@/lib/i18n";
import { SessionProvider } from "@/lib/session";
import "./globals.css";
import { RegisterSW } from "./register-sw";

export const metadata: Metadata = {
  title: "Exam Printery Desk",
  description: "Tracks exam printing, store stock, school sales, cash and debts.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#1f4fd1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=Inter:wght@400;500;600&display=swap" />
      </head>
      <body>
        <LangProvider>
          <SessionProvider>
            <ToastProvider>{children}</ToastProvider>
          </SessionProvider>
        </LangProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
