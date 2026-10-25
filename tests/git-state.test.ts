import { describe, expect, it } from "bun:test";
import { formatDiffBar, parseNumstat, parsePorcelainV2 } from "../src/services/gitState.ts";

describe("gitState", () => {
  describe("parsePorcelainV2", () => {
    it("parses clean repository with upstream and no ahead/behind", () => {
      const output = `# branch.oid 1234567890abcdef
# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0
`;
      const result = parsePorcelainV2(output);
      expect(result.branch).toBe("main");
      expect(result.upstream).toBe("origin/main");
      expect(result.ahead).toBe(0);
      expect(result.behind).toBe(0);
      expect(result.modifiedPaths).toEqual([]);
      expect(result.untrackedPaths).toEqual([]);
    });

    it("parses ahead, behind, modified, and untracked entries", () => {
      const output = `# branch.oid 1234567890abcdef
# branch.head feature
# branch.upstream origin/feature
# branch.ab +3 -1
1 M. N... 100644 100644 100644 123 456 src/index.ts
1 .M N... 100644 100644 100644 123 456 README.md
? untracked.txt
`;
      const result = parsePorcelainV2(output);
      expect(result.branch).toBe("feature");
      expect(result.upstream).toBe("origin/feature");
      expect(result.ahead).toBe(3);
      expect(result.behind).toBe(1);
      expect(result.modifiedPaths).toEqual(["src/index.ts", "README.md"]);
      expect(result.untrackedPaths).toEqual(["untracked.txt"]);
    });
  });

  describe("parseNumstat", () => {
    it("parses added/removed line stats and binary files", () => {
      const output = `12\t4\tsrc/file.ts\n-\t-\timage.png\n0\t5\tdeleted.txt\n`;
      const stats = parseNumstat(output);
      expect(stats).toHaveLength(3);
      expect(stats[0]).toEqual({ added: 12, removed: 4, path: "src/file.ts" });
      expect(stats[1]).toEqual({ added: null, removed: null, path: "image.png" });
      expect(stats[2]).toEqual({ added: 0, removed: 5, path: "deleted.txt" });
    });
  });

  describe("formatDiffBar", () => {
    it("formats proportional block diff bars", () => {
      const bar = formatDiffBar(10, 10, 20, 10);
      expect(bar.length).toBe(10);
      expect(bar.startsWith("█")).toBe(true);
      expect(bar.endsWith("░")).toBe(true);
    });

    it("formats binary files", () => {
      const bar = formatDiffBar(null, null, 20, 10);
      expect(bar).toBe("[binary]");
    });
  });
});
