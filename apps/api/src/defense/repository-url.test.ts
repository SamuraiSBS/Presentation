import { describe, expect, it } from "vitest";
import { parsePublicRepositoryUrl } from "./repository-url.js";

describe("parsePublicRepositoryUrl", () => {
  it("normalizes public GitHub and nested GitLab repository URLs", () => {
    expect(parsePublicRepositoryUrl("https://github.com/StudyDeck/app.git")).toMatchObject({
      provider: "github",
      namespace: "StudyDeck",
      repository: "app",
      normalizedUrl: "https://github.com/StudyDeck/app",
    });
    expect(parsePublicRepositoryUrl("https://gitlab.com/course/team/project")).toMatchObject({
      provider: "gitlab",
      namespace: "course/team",
      repository: "project",
    });
  });

  it.each([
    "http://github.com/org/repo",
    "https://127.0.0.1/org/repo",
    "https://localhost/org/repo",
    "https://github.com.evil.test/org/repo",
    "https://github.com@evil.test/org/repo",
    "https://token@github.com/org/repo",
    "https://github.com:8443/org/repo",
    "https://github.com/org/repo/tree/main",
    "https://github.com/org/repo?token=secret",
  ])("rejects unsafe or unsupported URL %s", (value) => {
    expect(() => parsePublicRepositoryUrl(value)).toThrow();
  });
});
