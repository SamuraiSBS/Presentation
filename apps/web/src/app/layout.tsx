import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "StudyDeck AI",
  description: "AI-сервис для учебных презентаций с источниками, заметками и экспортом.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Providers>
          <AppHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
