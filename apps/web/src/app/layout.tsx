import type { Metadata, Viewport } from "next";
import { getServerSession } from "next-auth";
import "@fontsource-variable/nunito";
import "./globals.css";
import { AppChrome } from "@/components/app-chrome";
import { AppQueryProvider } from "@/components/query-provider";
import { SessionProvider } from "@/components/session-provider";
import { authOptions } from "@/lib/auth-options";

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
  const session = await getServerSession(authOptions);
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
