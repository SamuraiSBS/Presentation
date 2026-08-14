import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { chromium } from "playwright";

const workspaceRoot = resolve(import.meta.dirname, "..");
const argumentsByName = new Map(process.argv.slice(2).map((argument) => {
  const [name, value] = argument.split("=", 2);
  return [name, value];
}));
const url = argumentsByName.get("--url") || "http://localhost:3000/";
const output = argumentsByName.get("--output");
const shouldAssert = argumentsByName.has("--assert");

const chrome = await launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const report = await lighthouse(url, {
    port: chrome.port,
    output: "json",
    onlyCategories: ["performance"],
    formFactor: "desktop",
    screenEmulation: { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false },
    throttlingMethod: "simulate",
    logLevel: "error",
  });
  if (!report?.lhr) throw new Error("Lighthouse did not return an LHR result.");

  const audits = report.lhr.audits;
  const metrics = {
    url: report.lhr.finalUrl,
    performanceScore: Number((report.lhr.categories.performance.score * 100).toFixed(0)),
    firstContentfulPaintMs: Math.round(audits["first-contentful-paint"].numericValue),
    largestContentfulPaintMs: Math.round(audits["largest-contentful-paint"].numericValue),
    totalBlockingTimeMs: Math.round(audits["total-blocking-time"].numericValue),
    cumulativeLayoutShift: Number(audits["cumulative-layout-shift"].numericValue.toFixed(3)),
    interactionToNextPaintMs: audits["interaction-to-next-paint"]?.numericValue ? Math.round(audits["interaction-to-next-paint"].numericValue) : null,
  };

  console.log(JSON.stringify(metrics, null, 2));
  if (output) writeFileSync(resolve(workspaceRoot, output), `${JSON.stringify({ metrics, lhr: report.lhr }, null, 2)}\n`);

  if (shouldAssert) {
    const thresholds = {
      performanceScore: 70,
      largestContentfulPaintMs: 3500,
      totalBlockingTimeMs: 500,
      cumulativeLayoutShift: 0.1,
    };
    const failures = [
      metrics.performanceScore < thresholds.performanceScore && `performance score ${metrics.performanceScore} < ${thresholds.performanceScore}`,
      metrics.largestContentfulPaintMs > thresholds.largestContentfulPaintMs && `LCP ${metrics.largestContentfulPaintMs}ms > ${thresholds.largestContentfulPaintMs}ms`,
      metrics.totalBlockingTimeMs > thresholds.totalBlockingTimeMs && `TBT ${metrics.totalBlockingTimeMs}ms > ${thresholds.totalBlockingTimeMs}ms`,
      metrics.cumulativeLayoutShift > thresholds.cumulativeLayoutShift && `CLS ${metrics.cumulativeLayoutShift} > ${thresholds.cumulativeLayoutShift}`,
    ].filter(Boolean);
    if (failures.length) throw new Error(`Lighthouse budget exceeded:\n${failures.join("\n")}`);
  }
} finally {
  // Chrome can already have released its process while Windows still holds
  // the launcher's temporary profile directory. Do not let that cleanup race
  // hide the Lighthouse result or budget verdict.
  try {
    await chrome.kill();
  } catch (error) {
    console.warn(`Lighthouse Chrome cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
  }
}
