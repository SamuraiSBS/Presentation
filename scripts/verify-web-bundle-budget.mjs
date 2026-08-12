import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const workspaceRoot = resolve(import.meta.dirname, "..");
const webRoot = resolve(workspaceRoot, "apps/web");
const nextRoot = resolve(webRoot, ".next");
const legacyManifestPath = resolve(nextRoot, "app-build-manifest.json");
const buildManifestPath = resolve(nextRoot, "build-manifest.json");
const budgetPath = resolve(webRoot, "bundle-budget.json");
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const outputPath = outputArgument ? resolve(workspaceRoot, outputArgument.slice("--output=".length)) : null;

if (!existsSync(legacyManifestPath) && !existsSync(buildManifestPath)) {
  throw new Error(`Production build manifests are missing under: ${nextRoot}. Run npm run build -w @studydeck/web first.`);
}

const legacyManifest = existsSync(legacyManifestPath) ? JSON.parse(readFileSync(legacyManifestPath, "utf8")) : null;
const buildManifest = JSON.parse(readFileSync(buildManifestPath, "utf8"));
const pages = legacyManifest?.pages;
if (legacyManifest && (!pages || typeof pages !== "object")) throw new Error("app-build-manifest.json does not contain a pages map.");

const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
const routeTargets = Object.keys(budget.routes);
const bytesByAsset = new Map();

function collectAssets(value, assets = new Set()) {
  if (typeof value === "string") {
    if (/\.(?:css|js)$/u.test(value)) assets.add(value);
    return assets;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectAssets(item, assets));
    return assets;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectAssets(item, assets));
  }
  return assets;
}

function resolveManifestRoute(target) {
  if (pages[target]) return target;
  const aliases = target === "/page" ? ["/", "/index", "/(root)/page"] : [];
  for (const alias of aliases) if (pages[alias]) return alias;
  const match = Object.keys(pages).find((route) => route.endsWith(target));
  if (!match) throw new Error(`Route ${target} is absent from app-build-manifest.json.`);
  return match;
}

function next16RouteAssets(target) {
  const manifestPath = resolve(nextRoot, "server/app", `${target.slice(1)}_client-reference-manifest.js`);
  if (!existsSync(manifestPath)) throw new Error(`Route ${target} is absent from Next client-reference manifests.`);

  const context = { globalThis: {} };
  runInNewContext(readFileSync(manifestPath, "utf8"), context, { filename: manifestPath });
  const manifest = context.globalThis.__RSC_MANIFEST?.[target];
  if (!manifest) throw new Error(`Client-reference manifest does not contain ${target}.`);

  const assets = new Set(buildManifest.rootMainFiles.filter((asset) => /\.(?:css|js)$/u.test(asset)));
  const segments = target.slice(1).split("/");
  const routeFiles = [resolve(nextRoot, "server/app", "layout.js")];
  for (let index = 1; index < segments.length; index += 1) {
    const layoutPath = resolve(nextRoot, "server/app", ...segments.slice(0, index), "layout.js");
    if (existsSync(layoutPath)) routeFiles.push(layoutPath);
  }
  routeFiles.push(resolve(nextRoot, "server/app", `${target.slice(1)}.js`));

  const clientReferences = new Set();
  for (const routeFile of routeFiles) {
    if (!existsSync(routeFile)) continue;
    for (const match of readFileSync(routeFile, "utf8").matchAll(/registerClientReference\)\(.*?,"([^"]+)"/gu)) clientReferences.add(match[1].replaceAll("\\\\", "\\"));
  }
  for (const reference of clientReferences) {
    const module = manifest.clientModules?.[reference];
    if (!module) throw new Error(`Client-reference manifest is missing ${reference} for ${target}.`);
    for (const chunk of module.chunks ?? []) if (typeof chunk === "string" && /\.(?:css|js)$/u.test(chunk)) assets.add(chunk);
  }
  for (const entries of Object.values(manifest.entryCSSFiles ?? {})) {
    for (const entry of entries) if (typeof entry?.path === "string" && /\.css$/u.test(entry.path)) assets.add(entry.path);
  }
  return assets;
}

function resolveAssetPath(asset) {
  const normalized = decodeURIComponent(asset.replace(/^\/_next\//u, "").replace(/^\//u, ""));
  if (!normalized.startsWith("static/")) {
    throw new Error(`Unsupported non-static manifest asset: ${asset}`);
  }
  return resolve(nextRoot, normalized);
}

function assetBytes(asset) {
  if (!bytesByAsset.has(asset)) {
    const path = resolveAssetPath(asset);
    if (!existsSync(path)) throw new Error(`Manifest asset is missing from the production build: ${asset}`);
    bytesByAsset.set(asset, statSync(path).size);
  }
  return bytesByAsset.get(asset);
}

function summarize(assets) {
  const summary = { javascriptBytes: 0, cssBytes: 0, totalBytes: 0, assets: [...assets].sort() };
  for (const asset of assets) {
    const bytes = assetBytes(asset);
    summary.totalBytes += bytes;
    if (asset.endsWith(".js")) summary.javascriptBytes += bytes;
    if (asset.endsWith(".css")) summary.cssBytes += bytes;
  }
  return summary;
}

const routeAssets = new Map();
for (const target of routeTargets) {
  if (legacyManifest) {
    const manifestRoute = resolveManifestRoute(target);
    routeAssets.set(target, collectAssets(pages[manifestRoute]));
  } else {
    routeAssets.set(target, next16RouteAssets(target));
  }
}

const sharedAssets = [...routeAssets.values()].reduce(
  (shared, assets) => new Set([...shared].filter((asset) => assets.has(asset))),
  new Set(routeAssets.values().next().value),
);

const result = {
  generatedAt: new Date().toISOString(),
  manifestPath: (legacyManifestPath && existsSync(legacyManifestPath) ? legacyManifestPath : buildManifestPath).replace(workspaceRoot + "\\", ""),
  shared: summarize(sharedAssets),
  routes: Object.fromEntries([...routeAssets].map(([route, assets]) => [route, summarize(assets)])),
};

function kib(bytes) {
  return Number((bytes / 1024).toFixed(1));
}

function display(name, summary) {
  return `${name.padEnd(36)} JS ${String(kib(summary.javascriptBytes)).padStart(7)} KiB  CSS ${String(kib(summary.cssBytes)).padStart(7)} KiB  total ${String(kib(summary.totalBytes)).padStart(7)} KiB`;
}

console.log(display("shared", result.shared));
for (const [route, summary] of Object.entries(result.routes)) console.log(display(route, summary));

const violations = [];
function verify(name, summary, limits) {
  for (const [metric, bytes] of Object.entries({ javascriptKiB: summary.javascriptBytes, cssKiB: summary.cssBytes, totalKiB: summary.totalBytes })) {
    if (limits[metric] === undefined) continue;
    if (kib(bytes) > limits[metric]) violations.push(`${name}: ${metric} ${kib(bytes)} KiB exceeds ${limits[metric]} KiB`);
  }
}

verify("shared", result.shared, budget.shared);
for (const [route, summary] of Object.entries(result.routes)) verify(route, summary, budget.routes[route]);

if (outputPath) writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
if (violations.length) throw new Error(`Web bundle budget exceeded:\n${violations.join("\n")}`);
