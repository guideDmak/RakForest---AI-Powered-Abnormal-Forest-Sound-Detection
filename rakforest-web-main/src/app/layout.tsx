import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { LanguageProvider } from "@/lib/i18n/language";
import { appTitle, appDescription, englishText, thaiText, languageCookie, type Language } from "@/lib/i18n/messages";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

async function preferredLanguage(): Promise<Language> {
  return (await cookies()).get(languageCookie)?.value === "en" ? "en" : "th";
}

export async function generateMetadata(): Promise<Metadata> {
  const t = (await preferredLanguage()) === "en" ? englishText : thaiText;
  return { title: t(appTitle), description: t(appDescription), manifest: "/manifest.json" };
}

export const viewport: Viewport = {
  themeColor: "#1B4332",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const language = await preferredLanguage();
  return (
    <html lang={language} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="min-h-screen bg-[#F2F4F1] text-[#14241B] antialiased"
        suppressHydrationWarning
      >
        <LanguageProvider initial={language}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
