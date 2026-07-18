import path from "node:path";

const INPUT_HOSTS = new Set(["github.com", "gitlab.com"]);
const FETCH_HOSTS = new Set(["api.github.com", "raw.githubusercontent.com", "gitlab.com"]);
const DOCUMENT_EXTENSIONS = new Set([".md", ".txt", ".pdf", ".docx", ".pptx"]);

export const DEFENSE_REPOSITORY_LIMITS = {
  timeoutMs: 12_000,
  maxRedirects: 3,
  maxFiles: 24,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
} as const;

export type PublicRepository = {
  provider: "github" | "gitlab";
  ownerPath: string;
  repository: string;
  canonicalUrl: string;
};

export type RepositoryDocument = {
  path: string;
  url: string;
  buffer: Buffer;
};

export function parsePublicRepositoryUrl(value: string): PublicRepository {
  let url: URL;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Repository URL is invalid");
  }
  if (url.protocol !== "https:") throw new Error("Repository URL must use HTTPS");
  if (url.username || url.password) throw new Error("Repository URL must not include credentials");
  if (url.port) throw new Error("Repository URL must not include a custom port");
  const hostname = url.hostname.toLowerCase();
  if (!INPUT_HOSTS.has(hostname)) throw new Error("Only public GitHub and GitLab repositories are supported");

  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) {
    throw new Error("Repository path is invalid");
  }
  const markerIndex = segments.findIndex((segment) => segment === "-" || segment === "tree" || segment === "blob");
  const repositorySegments = markerIndex >= 0 ? segments.slice(0, markerIndex) : segments;
  if (hostname === "github.com" && repositorySegments.length !== 2) {
    throw new Error("GitHub URL must point to a repository root");
  }
  if (hostname === "gitlab.com" && repositorySegments.length < 2) {
    throw new Error("GitLab URL must point to a repository root");
  }

  const repository = repositorySegments.at(-1)?.replace(/\.git$/i, "") || "";
  const ownerPath = repositorySegments.slice(0, -1).join("/");
  if (!repository || !ownerPath) throw new Error("Repository URL is incomplete");
  const canonicalUrl = `https://${hostname}/${ownerPath}/${repository}`;
  return { provider: hostname === "github.com" ? "github" : "gitlab", ownerPath, repository, canonicalUrl };
}

export async function fetchPublicRepositoryDocuments(
  input: string | PublicRepository,
  options: {
    fetch?: typeof fetch;
    githubToken?: string;
    gitlabToken?: string;
    limits?: Partial<typeof DEFENSE_REPOSITORY_LIMITS>;
  } = {},
): Promise<RepositoryDocument[]> {
  const repository = typeof input === "string" ? parsePublicRepositoryUrl(input) : input;
  const limits = { ...DEFENSE_REPOSITORY_LIMITS, ...options.limits };
  const fetchImpl = options.fetch || fetch;
  return repository.provider === "github"
    ? fetchGitHubDocuments(repository, fetchImpl, limits, options.githubToken)
    : fetchGitLabDocuments(repository, fetchImpl, limits, options.gitlabToken);
}

type ResolvedLimits = typeof DEFENSE_REPOSITORY_LIMITS;

async function fetchGitHubDocuments(repository: PublicRepository, fetchImpl: typeof fetch, limits: ResolvedLimits, token?: string) {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "StudyDeck-defense-ingestion" };
  if (token?.trim()) headers.authorization = `Bearer ${token.trim()}`;
  const base = `https://api.github.com/repos/${encodeURIComponent(repository.ownerPath)}/${encodeURIComponent(repository.repository)}/contents`;
  const root = await fetchJson(base, fetchImpl, limits, headers) as GitHubContent[];
  const docs = root.filter((item) => item.type === "dir" && /^(docs|documentation)$/i.test(item.name));
  const files = root.filter((item) => item.type === "file" && /^readme(?:\.|$)/i.test(item.name));
  for (const directory of docs.slice(0, 2)) {
    const nested = await fetchJson(directory.url, fetchImpl, limits, headers) as GitHubContent[];
    files.push(...nested.filter((item) => item.type === "file" && isRepositoryDocumentPath(item.path)));
  }
  return downloadRepositoryFiles(files.slice(0, limits.maxFiles).map((item) => ({ path: item.path, url: item.download_url || "", headers })), fetchImpl, limits);
}

async function fetchGitLabDocuments(repository: PublicRepository, fetchImpl: typeof fetch, limits: ResolvedLimits, token?: string) {
  const headers: Record<string, string> = { "user-agent": "StudyDeck-defense-ingestion" };
  if (token?.trim()) headers["private-token"] = token.trim();
  const project = encodeURIComponent(`${repository.ownerPath}/${repository.repository}`);
  const base = `https://gitlab.com/api/v4/projects/${project}/repository/tree?per_page=100`;
  const root = await fetchJson(base, fetchImpl, limits, headers) as GitLabTreeItem[];
  const files = root.filter((item) => item.type === "blob" && /^readme(?:\.|$)/i.test(item.name));
  for (const directory of root.filter((item) => item.type === "tree" && /^(docs|documentation)$/i.test(item.name)).slice(0, 2)) {
    const nested = await fetchJson(`${base}&path=${encodeURIComponent(directory.path)}`, fetchImpl, limits, headers) as GitLabTreeItem[];
    files.push(...nested.filter((item) => item.type === "blob" && isRepositoryDocumentPath(item.path)));
  }
  const downloads = files.slice(0, limits.maxFiles).map((item) => ({
    path: item.path,
    url: `https://gitlab.com/api/v4/projects/${project}/repository/files/${encodeURIComponent(item.path)}/raw?ref=HEAD`,
    headers,
  }));
  return downloadRepositoryFiles(downloads, fetchImpl, limits);
}

async function downloadRepositoryFiles(
  items: Array<{ path: string; url: string; headers: Record<string, string> }>,
  fetchImpl: typeof fetch,
  limits: ResolvedLimits,
) {
  const documents: RepositoryDocument[] = [];
  let totalBytes = 0;
  for (const item of items) {
    if (!item.url || !isRepositoryDocumentPath(item.path)) continue;
    const response = await fetchWithLimits(item.url, fetchImpl, limits, item.headers);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > limits.maxFileBytes) throw new Error("Repository document exceeds the size limit");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limits.maxFileBytes) throw new Error("Repository document exceeds the size limit");
    totalBytes += buffer.length;
    if (totalBytes > limits.maxTotalBytes) throw new Error("Repository documents exceed the total size limit");
    documents.push({ path: item.path, url: response.url || item.url, buffer });
  }
  if (!documents.length) throw new Error("Repository does not contain a supported README or docs/documentation file");
  return documents;
}

async function fetchJson(url: string, fetchImpl: typeof fetch, limits: ResolvedLimits, headers: Record<string, string>) {
  const response = await fetchWithLimits(url, fetchImpl, limits, headers);
  return response.json();
}

async function fetchWithLimits(url: string, fetchImpl: typeof fetch, limits: ResolvedLimits, headers: Record<string, string>) {
  let current = new URL(url);
  for (let redirect = 0; redirect <= limits.maxRedirects; redirect += 1) {
    assertFetchUrl(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(current, { headers, redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Repository response redirect is missing a location");
      current = new URL(location, current);
      continue;
    }
    if (response.status === 403 || response.status === 429) {
      throw new Error("Repository rate limit exceeded; upload a ZIP or README instead");
    }
    if (!response.ok) throw new Error(`Repository request failed with HTTP ${response.status}`);
    return response;
  }
  throw new Error("Repository request exceeded the redirect limit");
}

function assertFetchUrl(url: URL) {
  if (url.protocol !== "https:" || url.username || url.password || url.port || !FETCH_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Repository redirect target is not allowed");
  }
}

function isRepositoryDocumentPath(value: string) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const extension = path.posix.extname(normalized).toLowerCase();
  if (!DOCUMENT_EXTENSIONS.has(extension)) return false;
  const segments = normalized.toLowerCase().split("/");
  const filename = segments.at(-1) || "";
  return /^readme(?:\.|$)/i.test(filename) || segments[0] === "docs" || segments[0] === "documentation";
}

type GitHubContent = { type: "file" | "dir"; name: string; path: string; url: string; download_url?: string | null };
type GitLabTreeItem = { type: "blob" | "tree"; name: string; path: string };
