import type { Metadata } from "next";
import "@fontsource-variable/nunito";
import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";

export const metadata: Metadata = {
  title: "StudyDeck AI",
  description: "AI-сервис для учебных презентаций с заметками, рассказом и экспортом.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AppHeader />
        <div className="app-content">{children}</div>
        <MobileBottomNav />
      </body>
    </html>
  );
}
