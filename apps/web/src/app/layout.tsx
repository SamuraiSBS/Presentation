import type { Metadata, Viewport } from "next";
import "@fontsource-variable/nunito";
import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { AppQueryProvider } from "@/components/query-provider";

export const metadata: Metadata = {
  title: "StudyDeck AI",
  description: "AI-помощник для учебных презентаций, заметок и подготовки к выступлению.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AppQueryProvider>
          <AppHeader />
          <div className="app-content">{children}</div>
          <MobileBottomNav />
        </AppQueryProvider>
      </body>
    </html>
  );
}
