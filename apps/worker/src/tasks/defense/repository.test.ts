import { describe, expect, it, vi } from "vitest";
import { fetchPublicRepositoryDocuments, parsePublicRepositoryUrl } from "./repository.js";

describe("public defense repository ingestion", () => {
  it("accepts only canonical public GitHub/GitLab HTTPS repository URLs", () => {
    expect(parsePublicRepositoryUrl("https://github.com/acme/demo")).toMatchObject({ provider: "github", ownerPath: "acme", repository: "demo" });
    expect(parsePublicRepositoryUrl("https://gitlab.com/acme/team/demo.git")).toMatchObject({ provider: "gitlab", ownerPath: "acme/team", repository: "demo" });
    expect(() => parsePublicRepositoryUrl("http://github.com/acme/demo")).toThrow(/HTTPS/);
    expect(() => parsePublicRepositoryUrl("https://user:pass@github.com/acme/demo")).toThrow(/credentials/);
    expect(() => parsePublicRepositoryUrl("https://127.0.0.1/acme/demo")).toThrow(/Only public/);
    expect(() => parsePublicRepositoryUrl("https://github.com:8443/acme/demo")).toThrow(/custom port/);
  });

  it("fetches only README/docs and never traverses source files", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/contents")) {
        return jsonResponse([
          { type: "file", name: "README.md", path: "README.md", url: "api-readme", download_url: "https://raw.githubusercontent.com/acme/demo/main/README.md" },
          { type: "dir", name: "docs", path: "docs", url: "https://api.github.com/repos/acme/demo/contents/docs" },
          { type: "file", name: "index.ts", path: "src/index.ts", url: "api-source", download_url: "https://raw.githubusercontent.com/acme/demo/main/src/index.ts" },
        ], url);
      }
      if (url.endsWith("/contents/docs")) {
        return jsonResponse([{ type: "file", name: "spec.md", path: "docs/spec.md", url: "api-spec", download_url: "https://raw.githubusercontent.com/acme/demo/main/docs/spec.md" }], url);
      }
      return new Response(url.includes("README") ? "readme" : "spec", { status: 200, headers: { "content-type": "text/plain" } });
    }) as unknown as typeof fetch;

    const documents = await fetchPublicRepositoryDocuments("https://github.com/acme/demo", { fetch: fetchMock });
    expect(documents.map((item) => item.path)).toEqual(["README.md", "docs/spec.md"]);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("src/index.ts"), expect.anything());
  });
});

function jsonResponse(value: unknown, url: string) {
  const response = new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
