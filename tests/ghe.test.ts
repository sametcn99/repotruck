import { describe, expect, test } from "bun:test";
import { extraHeaderKeyForUrl } from "../src/services/cloner.ts";
import { normalizeBaseUrl, resolveGithubBaseUrl } from "../src/services/settings.ts";
import { GITHUB_HOST, parseGitUrl } from "../src/services/singleCloner.ts";

describe("GitHub Enterprise (GHE) base URL normalization", () => {
  test("github.com returns default api.github.com", () => {
    expect(normalizeBaseUrl("https://github.com")).toBe("https://api.github.com");
    expect(normalizeBaseUrl("https://api.github.com")).toBe("https://api.github.com");
  });

  test("GHE URLs automatically append /api/v3 when omitted", () => {
    expect(normalizeBaseUrl("https://ghe.mycompany.com")).toBe("https://ghe.mycompany.com/api/v3");
    expect(normalizeBaseUrl("https://ghe.mycompany.com/")).toBe("https://ghe.mycompany.com/api/v3");
    expect(normalizeBaseUrl("https://ghe.mycompany.com/api/v3")).toBe(
      "https://ghe.mycompany.com/api/v3",
    );
  });

  test("invalid URLs throw a friendly error", () => {
    expect(() => normalizeBaseUrl("not-a-valid-url")).toThrow();
  });

  test("resolveGithubBaseUrl respects flag > setting > default", async () => {
    const defaultUrl = await resolveGithubBaseUrl({});
    expect(defaultUrl).toBe("https://api.github.com");

    const flagUrl = await resolveGithubBaseUrl({}, "https://ghe-flag.corp.com");
    expect(flagUrl).toBe("https://ghe-flag.corp.com/api/v3");
  });
});

describe("extraHeaderKeyForUrl origin derivation (GH6)", () => {
  test("derives standard github.com key byte-identically", () => {
    expect(extraHeaderKeyForUrl("https://github.com/owner/repo.git")).toBe(
      "http.https://github.com/.extraheader",
    );
    expect(extraHeaderKeyForUrl("https://github.com/foo/bar")).toBe(
      "http.https://github.com/.extraheader",
    );
  });

  test("derives GHE key for custom host and port", () => {
    expect(extraHeaderKeyForUrl("https://ghe.corp.internal/owner/repo.git")).toBe(
      "http.https://ghe.corp.internal/.extraheader",
    );
    expect(extraHeaderKeyForUrl("https://ghe.corp.internal:8443/owner/repo.git")).toBe(
      "http.https://ghe.corp.internal:8443/.extraheader",
    );
  });

  test("falls back gracefully for invalid or unparseable URLs", () => {
    expect(extraHeaderKeyForUrl("not-a-url")).toBe("http.https://github.com/.extraheader");
  });
});

describe("singleCloner GHE host restrictions and parseGitUrl", () => {
  test("GITHUB_HOST constant is github.com", () => {
    expect(GITHUB_HOST).toBe("github.com");
  });

  test("parseGitUrl accepts custom hosts when specified", () => {
    const parsedGhe = parseGitUrl("https://ghe.mycompany.com/team/project.git", [
      "github.com",
      "ghe.mycompany.com",
    ]);
    expect(parsedGhe).not.toBeNull();
    expect(parsedGhe?.owner).toBe("team");
    expect(parsedGhe?.name).toBe("project");
  });

  test("parseGitUrl rejects unknown hosts by default", () => {
    const parsedUnknown = parseGitUrl("https://gitlab.com/team/project.git");
    expect(parsedUnknown).toBeNull();
  });
});
