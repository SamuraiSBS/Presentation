import type { Metadata, Viewport } from "next";
import "@fontsource-variable/nunito";
import "./globals.css";
import "./landing.css";
import { AppChrome } from "@/components/app-chrome";
import { AppQueryProvider } from "@/components/query-provider";
import { SessionProvider } from "@/components/session-provider";
import { auth } from "@/auth";

export const metadata: Metadata = {
  title: "StudyDeck AI",
  description: "AI-помощник для учебных презентаций, заметок и подготовки к выступлению.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="ru">
      <body>
        <SessionProvider session={session}>
          <AppQueryProvider>
            <AppChrome>{children}</AppChrome>
          </AppQueryProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
