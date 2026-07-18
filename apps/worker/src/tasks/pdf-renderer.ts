import { existsSync } from "node:fs";

export async function renderHtmlToPdf(
  html: string,
  options: {
    viewportWidth?: number;
    viewportHeight?: number;
    pageWidth?: string;
    pageHeight?: string;
    format?: "A4";
  } = {},
) {
  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.default.launch({
    executablePath: chromiumExecutablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: options.viewportWidth || 1280,
      height: options.viewportHeight || 720,
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return Buffer.from(await page.pdf({
      printBackground: true,
      ...(options.format
        ? { format: options.format }
        : { width: options.pageWidth || "1280px", height: options.pageHeight || "720px" }),
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
    }));
  } finally {
    await browser.close();
  }
}

export function chromiumExecutablePath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean) as string[];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error("Chromium executable was not found. Set CHROMIUM_PATH or install chromium in the worker image.");
  }
  return executable;
}
