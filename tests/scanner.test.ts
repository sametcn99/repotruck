import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RepotruckConfig } from "../src/services/config.ts";
import {
  buildAdoptPlan,
  type DiscoveredRepo,
  scanWorkspaceRepos,
} from "../src/services/scanner.ts";

describe("scanner", () => {
  it("buildAdoptPlan calculates target path using preset and detects move need", () => {
    const config: RepotruckConfig = {
      version: 1,
      root: "C:/test",
      lastSync: null,
      preset: "flat-by-owner",
      repos: [],
    };
    const repos: DiscoveredRepo[] = [
      {
        owner: "testowner",
        name: "myrepo",
        relativePath: "random/folder/myrepo",
        absolutePath: "C:/test/random/folder/myrepo",
        remoteUrl: "git@github.com:testowner/myrepo.git",
        internal: true,
      },
    ];

    const plans = buildAdoptPlan("C:/test", config, repos);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.targetRelativePath).toBe("testowner/myrepo");
    expect(plans[0]?.needsMove).toBe(true);
  });

  it("scanWorkspaceRepos separates tracked and unregistered repos", async () => {
    const root = path.join(tmpdir(), `repotruck-scan-test-${Date.now()}`);
    mkdirSync(root, { recursive: true });

    const config: RepotruckConfig = {
      version: 1,
      root,
      lastSync: null,
      preset: "flat",
      repos: [
        {
          owner: "tracked",
          name: "repo1",
          category: "source",
          language: null,
          relativePath: "repo1",
          internal: true,
          custom: false,
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    const result = await scanWorkspaceRepos(root, config);
    expect(result.tracked).toHaveLength(0);
    expect(result.unregistered).toHaveLength(0);

    rmSync(root, { recursive: true, force: true });
  });
});
