import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { getWorkspaceStatus } from "../src/core/inspect.ts";
import type { RepotruckConfig } from "../src/services/config.ts";
import { updateWorkspace } from "../src/services/workspace.ts";

describe("status e2e integration", () => {
  it("collects diff stats and detects unpushed commits with detail flag", async () => {
    const root = path.join(tmpdir(), `repotruck-status-test-${Date.now()}`);
    const bareRemote = path.join(tmpdir(), `repotruck-status-remote-${Date.now()}`);
    const repoDir = path.join(root, "myowner", "myrepo");
    mkdirSync(repoDir, { recursive: true });

    // 1. Setup bare remote
    const gitRemote = simpleGit();
    await gitRemote.init(true, [bareRemote]);

    // 2. Setup local repo
    const git = simpleGit(repoDir);
    await git.init();
    await git.addRemote("origin", bareRemote);
    await git.raw(["config", "user.name", "Test User"]);
    await git.raw(["config", "user.email", "test@example.com"]);

    writeFileSync(path.join(repoDir, "file1.txt"), "hello\nworld\n");
    await git.add("file1.txt");
    await git.commit("initial commit");
    await git.raw(["push", "-u", "origin", "master"]);

    // 3. Make an unpushed commit + modified file + untracked file
    writeFileSync(path.join(repoDir, "file1.txt"), "hello\nworld\nnew line\n");
    await git.add("file1.txt");
    await git.commit("second commit with additions");

    writeFileSync(path.join(repoDir, "file2.txt"), "another file\n");
    await git.add("file2.txt");

    writeFileSync(path.join(repoDir, "untracked.txt"), "untracked content\n");

    // 4. Save workspace config
    const config: RepotruckConfig = {
      version: 1,
      root,
      lastSync: "2026-10-25T12:00:00.000Z",
      preset: "flat-by-owner",
      repos: [
        {
          owner: "myowner",
          name: "myrepo",
          category: "source",
          language: "TypeScript",
          relativePath: "myowner/myrepo",
          internal: true,
          custom: false,
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await updateWorkspace(root, () => ({ config, result: undefined }));

    // 5. Test getWorkspaceStatus with detail: true
    const status = await getWorkspaceStatus(root, undefined, { detail: true });
    expect(status.repos).toHaveLength(1);
    const r = status.repos[0];
    if (!r) throw new Error("Expected repo status to be defined");
    expect(r.key).toBe("myowner/myrepo");
    expect(r.dirty).toBe(true);
    expect(r.ahead).toBe(1);
    expect(r.behind).toBe(0);

    // Detail payload check
    expect(r.details).toBeDefined();
    expect(r.details?.outgoingCommits).toHaveLength(1);
    expect(r.details?.outgoingCommits[0]?.subject).toBe("second commit with additions");
    expect(r.details?.modifiedFiles.length).toBeGreaterThan(0);
    expect(r.details?.untrackedFiles).toContain("untracked.txt");

    rmSync(root, { recursive: true, force: true });
    rmSync(bareRemote, { recursive: true, force: true });
  });
});
