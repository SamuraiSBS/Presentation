import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ESLint } from "eslint";

const baselinePath = resolve("config/lint-baseline.json");
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const today = new Date().toISOString().slice(0, 10);

if (!Number.isInteger(baseline.maxWarnings) || baseline.maxWarnings < 0) {
  throw new Error("config/lint-baseline.json must contain a non-negative integer maxWarnings");
}

if (baseline.maxWarnings > 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseline.expiresOn)) {
    throw new Error("A non-zero lint baseline must contain expiresOn in YYYY-MM-DD format");
  }

  if (today > baseline.expiresOn) {
    throw new Error(
      `Lint baseline expired on ${baseline.expiresOn}. Remove the debt or explicitly renew the baseline with a new review.`,
    );
  }
}

const eslint = new ESLint();
const results = await eslint.lintFiles(["apps", "packages", "e2e"]);
const formatter = await eslint.loadFormatter("stylish");
const output = formatter.format(results);
if (output) process.stdout.write(output);

const errors = results.reduce((total, result) => total + result.errorCount, 0);
const warnings = results.reduce((total, result) => total + result.warningCount, 0);

if (errors || warnings > baseline.maxWarnings) {
  throw new Error(
    `Lint gate failed: ${errors} error(s), ${warnings} warning(s); allowed warning baseline is ${baseline.maxWarnings} until ${baseline.expiresOn}.`,
  );
}

console.log(
  baseline.maxWarnings === 0
    ? "Lint gate passed: 0 warnings allowed."
    : `Lint gate passed: ${warnings} warning(s) within the temporary ${baseline.maxWarnings} baseline (expires ${baseline.expiresOn}).`,
);
