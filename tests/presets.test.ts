import { describe, expect, test } from "bun:test";
import {
  type CustomPreset,
  isInternalOwner,
  isPresetId,
  isPresetRef,
  languageSegment,
  nextPreset,
  PRESET_IDS,
  type PresetId,
  repoCategory,
  sanitizeSegment,
  targetSegments,
  targetSegmentsForPreset,
  validateCustomPreset,
} from "../src/presets/index.ts";

describe("repoCategory", () => {
  test("archived wins over fork", () => {
    expect(repoCategory({ isArchived: true, isFork: true })).toBe("archived");
  });

  test("fork when not archived", () => {
    expect(repoCategory({ isArchived: false, isFork: true })).toBe("forks");
  });

  test("source otherwise", () => {
    expect(repoCategory({ isArchived: false, isFork: false })).toBe("source");
  });
});

describe("sanitizeSegment", () => {
  test("replaces illegal Windows characters with dashes", () => {
    expect(sanitizeSegment('a<b>c:d"e/f\\g|h?i*j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  test("replaces control characters with dashes", () => {
    expect(sanitizeSegment("a\u0000b\u001fc")).toBe("a-b-c");
  });

  test("strips trailing dots and spaces", () => {
    expect(sanitizeSegment("repo.")).toBe("repo");
    expect(sanitizeSegment("repo . .")).toBe("repo");
    expect(sanitizeSegment("repo  ")).toBe("repo");
  });

  test("keeps internal dots", () => {
    expect(sanitizeSegment("my.repo")).toBe("my.repo");
  });

  test("empty or fully stripped segment becomes other", () => {
    expect(sanitizeSegment("")).toBe("other");
    expect(sanitizeSegment(".")).toBe("other");
    expect(sanitizeSegment("   ")).toBe("other");
    expect(sanitizeSegment("...")).toBe("other");
  });
});

describe("languageSegment", () => {
  test("null becomes other", () => {
    expect(languageSegment(null)).toBe("other");
  });

  test("passes languages through", () => {
    expect(languageSegment("TypeScript")).toBe("TypeScript");
    expect(languageSegment("C#")).toBe("C#");
  });
});

describe("targetSegments", () => {
  const baseRepo = {
    owner: "acme",
    name: "api",
    isArchived: false,
    isFork: false,
    language: "TypeScript",
  };

  test("categorized internal", () => {
    expect(targetSegments(baseRepo, "categorized", true)).toEqual(["acme", "source", "api"]);
  });

  test("categorized community", () => {
    expect(targetSegments(baseRepo, "categorized", false)).toEqual([
      "community",
      "acme",
      "source",
      "api",
    ]);
  });

  test("flat-by-owner internal", () => {
    expect(targetSegments(baseRepo, "flat-by-owner", true)).toEqual(["acme", "api"]);
  });

  test("flat-by-owner community", () => {
    expect(targetSegments(baseRepo, "flat-by-owner", false)).toEqual(["community", "acme", "api"]);
  });

  test("topic-focused internal", () => {
    expect(targetSegments(baseRepo, "topic-focused", true)).toEqual(["acme", "TypeScript", "api"]);
  });

  test("topic-focused community", () => {
    expect(targetSegments(baseRepo, "topic-focused", false)).toEqual([
      "community",
      "acme",
      "TypeScript",
      "api",
    ]);
  });

  test("topic-focused with null language uses other", () => {
    expect(targetSegments({ ...baseRepo, language: null }, "topic-focused", true)).toEqual([
      "acme",
      "other",
      "api",
    ]);
  });

  test("categorized archived community uses archived category", () => {
    expect(targetSegments({ ...baseRepo, isArchived: true }, "categorized", false)).toEqual([
      "community",
      "acme",
      "archived",
      "api",
    ]);
  });

  test("categorized fork internal uses forks category", () => {
    expect(targetSegments({ ...baseRepo, isFork: true }, "categorized", true)).toEqual([
      "acme",
      "forks",
      "api",
    ]);
  });

  test("language-first internal", () => {
    expect(targetSegments(baseRepo, "language-first", true)).toEqual(["TypeScript", "acme", "api"]);
  });

  test("language-first community", () => {
    expect(targetSegments(baseRepo, "language-first", false)).toEqual([
      "community",
      "TypeScript",
      "acme",
      "api",
    ]);
  });

  test("language-first with null language uses other", () => {
    expect(targetSegments({ ...baseRepo, language: null }, "language-first", true)).toEqual([
      "other",
      "acme",
      "api",
    ]);
  });

  test("category-first internal", () => {
    expect(targetSegments(baseRepo, "category-first", true)).toEqual(["source", "acme", "api"]);
  });

  test("category-first archived community uses archived category", () => {
    expect(targetSegments({ ...baseRepo, isArchived: true }, "category-first", false)).toEqual([
      "community",
      "archived",
      "acme",
      "api",
    ]);
  });

  test("category-first fork internal uses forks category", () => {
    expect(targetSegments({ ...baseRepo, isFork: true }, "category-first", true)).toEqual([
      "forks",
      "acme",
      "api",
    ]);
  });

  test("language-categorized internal", () => {
    expect(targetSegments(baseRepo, "language-categorized", true)).toEqual([
      "acme",
      "source",
      "TypeScript",
      "api",
    ]);
  });

  test("language-categorized community", () => {
    expect(targetSegments(baseRepo, "language-categorized", false)).toEqual([
      "community",
      "acme",
      "source",
      "TypeScript",
      "api",
    ]);
  });

  test("language-categorized fork with null language", () => {
    expect(
      targetSegments({ ...baseRepo, isFork: true, language: null }, "language-categorized", true),
    ).toEqual(["acme", "forks", "other", "api"]);
  });

  test("flat internal and community", () => {
    expect(targetSegments(baseRepo, "flat", true)).toEqual(["api"]);
    expect(targetSegments(baseRepo, "flat", false)).toEqual(["community", "api"]);
  });

  test("category-flat internal and community", () => {
    expect(targetSegments(baseRepo, "category-flat", true)).toEqual(["source", "api"]);
    expect(targetSegments(baseRepo, "category-flat", false)).toEqual([
      "community",
      "source",
      "api",
    ]);
  });

  test("language-flat internal and community", () => {
    expect(targetSegments(baseRepo, "language-flat", true)).toEqual(["TypeScript", "api"]);
    expect(targetSegments(baseRepo, "language-flat", false)).toEqual([
      "community",
      "TypeScript",
      "api",
    ]);
  });

  test("category-language internal and community", () => {
    expect(targetSegments(baseRepo, "category-language", true)).toEqual([
      "source",
      "TypeScript",
      "api",
    ]);
    expect(targetSegments(baseRepo, "category-language", false)).toEqual([
      "community",
      "source",
      "TypeScript",
      "api",
    ]);
  });

  test("language-category internal and community", () => {
    expect(targetSegments(baseRepo, "language-category", true)).toEqual([
      "TypeScript",
      "source",
      "api",
    ]);
    expect(targetSegments(baseRepo, "language-category", false)).toEqual([
      "community",
      "TypeScript",
      "source",
      "api",
    ]);
  });

  test("owner-language-category internal and community", () => {
    expect(targetSegments(baseRepo, "owner-language-category", true)).toEqual([
      "acme",
      "TypeScript",
      "source",
      "api",
    ]);
    expect(targetSegments(baseRepo, "owner-language-category", false)).toEqual([
      "community",
      "acme",
      "TypeScript",
      "source",
      "api",
    ]);
  });

  test("category-owner-language internal and community", () => {
    expect(targetSegments(baseRepo, "category-owner-language", true)).toEqual([
      "source",
      "acme",
      "TypeScript",
      "api",
    ]);
    expect(targetSegments(baseRepo, "category-owner-language", false)).toEqual([
      "community",
      "source",
      "acme",
      "TypeScript",
      "api",
    ]);
  });

  test("category-language-owner internal and community", () => {
    expect(targetSegments(baseRepo, "category-language-owner", true)).toEqual([
      "source",
      "TypeScript",
      "acme",
      "api",
    ]);
    expect(targetSegments(baseRepo, "category-language-owner", false)).toEqual([
      "community",
      "source",
      "TypeScript",
      "acme",
      "api",
    ]);
  });

  test("language-owner-category internal and community", () => {
    expect(targetSegments(baseRepo, "language-owner-category", true)).toEqual([
      "TypeScript",
      "acme",
      "source",
      "api",
    ]);
    expect(targetSegments(baseRepo, "language-owner-category", false)).toEqual([
      "community",
      "TypeScript",
      "acme",
      "source",
      "api",
    ]);
  });

  test("language-category-owner internal and community", () => {
    expect(targetSegments(baseRepo, "language-category-owner", true)).toEqual([
      "TypeScript",
      "source",
      "acme",
      "api",
    ]);
    expect(targetSegments(baseRepo, "language-category-owner", false)).toEqual([
      "community",
      "TypeScript",
      "source",
      "acme",
      "api",
    ]);
  });
});

describe("isInternalOwner", () => {
  test("matches user login case-insensitively", () => {
    expect(isInternalOwner("MonaLisa", "monalisa", [])).toBe(true);
    expect(isInternalOwner("monalisa", "MONALISA", [])).toBe(true);
    expect(isInternalOwner("monalisa-dev", "monalisa", [])).toBe(false);
  });

  test("matches orgs case-insensitively", () => {
    expect(isInternalOwner("ACME-Corp", "otheruser", ["acme-corp"])).toBe(true);
    expect(isInternalOwner("acme-corp", "otheruser", ["ACME-CORP"])).toBe(true);
  });

  test("rejects unrelated owners", () => {
    expect(isInternalOwner("octocat", "monalisa", ["acme"])).toBe(false);
  });
});

describe("nextPreset", () => {
  test("cycles through PRESET_IDS", () => {
    for (let i = 0; i < PRESET_IDS.length; i += 1) {
      const current = PRESET_IDS[i]!;
      const expected = PRESET_IDS[(i + 1) % PRESET_IDS.length]!;
      expect(nextPreset(current)).toBe(expected);
    }
  });

  test("PRESET_IDS order matches cycle", () => {
    const order: PresetId[] = [];
    let current: PresetId = "categorized";
    for (let i = 0; i < PRESET_IDS.length; i += 1) {
      order.push(current);
      current = nextPreset(current);
    }
    expect(order).toEqual([...PRESET_IDS]);
  });
});

describe("isPresetId", () => {
  test("accepts valid ids", () => {
    for (const id of PRESET_IDS) {
      expect(isPresetId(id)).toBe(true);
    }
  });

  test("rejects invalid values", () => {
    expect(isPresetId("unknown")).toBe(false);
    expect(isPresetId(42)).toBe(false);
    expect(isPresetId(null)).toBe(false);
  });
});

describe("custom presets", () => {
  test("validateCustomPreset accepts token lists ending in name and rejects the rest", () => {
    expect(validateCustomPreset({ id: "custom-flat", segments: ["name"] })).toEqual({
      id: "custom-flat",
      segments: ["name"],
    });
    expect(validateCustomPreset({ id: "flat", segments: ["name"] })).toBeNull();
    expect(
      validateCustomPreset({ id: "lang-owner", segments: ["language", "owner", "name"] }),
    ).not.toBeNull();
    expect(validateCustomPreset({ id: "dup", segments: ["owner", "owner", "name"] })).toBeNull();
    expect(validateCustomPreset({ id: "no-name-last", segments: ["name", "owner"] })).toBeNull();
    expect(validateCustomPreset({ id: "Bad_ID", segments: ["name"] })).toBeNull();
    expect(validateCustomPreset({ id: "categorized", segments: ["name"] })).toBeNull();
    expect(
      validateCustomPreset({
        id: "too-long",
        segments: ["owner", "category", "language", "name", "name"],
      }),
    ).toBeNull();
    expect(validateCustomPreset({ id: "bogus-token", segments: ["stars", "name"] })).toBeNull();
  });

  test("targetSegmentsForPreset composes custom layouts and keeps the community prefix", () => {
    const custom: CustomPreset[] = [{ id: "lang-owner", segments: ["language", "owner", "name"] }];
    const repo = {
      owner: "monalisa",
      name: "api",
      isArchived: false,
      isFork: false,
      language: "TypeScript",
    };
    expect(targetSegmentsForPreset(repo, "lang-owner", true, custom)).toEqual([
      "TypeScript",
      "monalisa",
      "api",
    ]);
    expect(targetSegmentsForPreset(repo, "lang-owner", false, custom)).toEqual([
      "community",
      "TypeScript",
      "monalisa",
      "api",
    ]);
  });

  test("targetSegmentsForPreset passes built-ins through and throws on unknown ids", () => {
    const repo = {
      owner: "monalisa",
      name: "api",
      isArchived: false,
      isFork: false,
      language: null,
    };
    expect(targetSegmentsForPreset(repo, "flat-by-owner", true, [])).toEqual(["monalisa", "api"]);
    expect(() => targetSegmentsForPreset(repo, "ghost", true, [])).toThrow("unknown preset: ghost");
  });

  test("isPresetRef accepts built-ins and syntactically valid custom ids", () => {
    expect(isPresetRef("categorized")).toBe(true);
    expect(isPresetRef("my-layout")).toBe(true);
    expect(isPresetRef("Not Ok")).toBe(false);
    expect(isPresetRef(42)).toBe(false);
  });
});
