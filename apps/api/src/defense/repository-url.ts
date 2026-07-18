import { badRequest } from "../errors/api-error.js";

const allowedHosts = new Set(["github.com", "gitlab.com"]);
const segmentPattern = /^[A-Za-z0-9_.-]+$/;

export type PublicRepositoryLocator = {
  provider: "github" | "gitlab";
  host: "github.com" | "gitlab.com";
  namespace: string;
  repository: string;
  normalizedUrl: string;
};

export function parsePublicRepositoryUrl(value: string): PublicRepositoryLocator {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidRepositoryUrl();
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:"
    || !allowedHosts.has(host)
    || Boolean(url.username || url.password)
    || Boolean(url.port)
    || Boolean(url.search || url.hash)
  ) {
    throw invalidRepositoryUrl();
  }
  let segments: string[];
  try {
    segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    throw invalidRepositoryUrl();
  }
  if (segments.length < 2 || segments.some((segment) => !segmentPattern.test(segment) || segment === "." || segment === "..")) {
    throw invalidRepositoryUrl();
  }
  if (host === "github.com" && segments.length !== 2) {
    throw badRequest(
      "REPOSITORY_URL_UNSUPPORTED",
      "Для GitHub укажите корневую ссылку вида https://github.com/owner/repository",
    );
  }
  const repository = segments.at(-1)?.replace(/\.git$/i, "") || "";
  const namespaceSegments = segments.slice(0, -1);
  if (!repository || !segmentPattern.test(repository)) throw invalidRepositoryUrl();
  const provider = host === "github.com" ? "github" : "gitlab";
  const namespace = namespaceSegments.join("/");
  const normalizedPath = [...namespaceSegments, repository].map(encodeURIComponent).join("/");
  return {
    provider,
    host: host as PublicRepositoryLocator["host"],
    namespace,
    repository,
    normalizedUrl: `https://${host}/${normalizedPath}`,
  };
}

function invalidRepositoryUrl() {
  return badRequest(
    "INVALID_REPOSITORY_URL",
    "Поддерживаются только публичные корневые HTTPS-ссылки GitHub и GitLab без токенов и нестандартных портов",
  );
}
