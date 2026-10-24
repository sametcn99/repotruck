import { describe, expect, test } from "bun:test";
import {
  filterReposByKey,
  globToRegex,
  matchesGlob,
  parseFilterFlags,
} from "../src/services/filters.ts";

describe("sync filters (FI1-FI4)", () => {
  test("globToRegex handles *, **, and ? case-insensitively", () => {
    const starRegex = globToRegex("mona/*");
    expect(starRegex.test("mona/repo")).toBe(true);
    expect(starRegex.test("MONA/REPO")).toBe(true);
    expect(starRegex.test("mona/sub/repo")).toBe(false);

    const doubleStar = globToRegex("mona/**");
    expect(doubleStar.test("mona/repo")).toBe(true);
    expect(doubleStar.test("mona/sub/repo")).toBe(true);

    const questionRegex = globToRegex("repo-?");
    expect(questionRegex.test("repo-1")).toBe(true);
    expect(questionRegex.test("repo-a")).toBe(true);
    expect(questionRegex.test("repo-12")).toBe(false);
  });

  test("matchesGlob tests pattern against input", () => {
    expect(matchesGlob("org/*", "org/api")).toBe(true);
    expect(matchesGlob("org/*", "other/api")).toBe(false);
  });

  test("parseFilterFlags parses repeatable and comma-separated flags", () => {
    expect(parseFilterFlags(undefined)).toEqual([]);
    expect(parseFilterFlags("org/*")).toEqual(["org/*"]);
    expect(parseFilterFlags(["org/*", "team/*"])).toEqual(["org/*", "team/*"]);
    expect(parseFilterFlags("org/*, team/*, personal/*")).toEqual([
      "org/*",
      "team/*",
      "personal/*",
    ]);
  });

  test("filterReposByKey filters repos by include and exclude", () => {
    const repos = [
      { owner: "sametcn99", name: "repotruck" },
      { owner: "sametcn99", name: "test-app" },
      { owner: "sametcn99", name: "test-lib" },
      { owner: "other", name: "fork" },
    ];

    // Only sametcn99
    const onlySamet = filterReposByKey(repos, ["sametcn99/*"]);
    expect(onlySamet.length).toBe(3);

    // sametcn99 excluding test-*
    const withoutTests = filterReposByKey(repos, ["sametcn99/*"], ["*/test-*"]);
    expect(withoutTests).toEqual([{ owner: "sametcn99", name: "repotruck" }]);

    // Only exclude without include
    const excluded = filterReposByKey(repos, [], ["*/fork"]);
    expect(excluded.length).toBe(3);
    expect(excluded.some((r) => r.name === "fork")).toBe(false);
  });
});
