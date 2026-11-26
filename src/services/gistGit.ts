import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { cloneOrUpdate, firstErrorLine, gitWithTokenAuth } from "./cloner.ts";
import { gistId } from "./gistApi.ts";
import { withWorkspaceLock } from "./workspaceLock.ts";
import { workspacePath } from "./workspacePaths.ts";
import { inspectGitDotEntry } from "./worktree.ts";

type Git = ReturnType<typeof gitWithTokenAuth>;
export type GistLocalState = "missing" | "clean" | "dirty" | "invalid";

export function gistPath(root: string, id: string): string {
  const relativePath = `.repotruck/gists/${gistId(id)}`;
  const directory = workspacePath(root, relativePath);
  if (
    inspectGitDotEntry(path.dirname(directory)).kind !== "none" ||
    inspectGitDotEntry(path.dirname(path.dirname(directory))).kind !== "none"
  )
    throw new Error("The workspace Gist directory is inside an unrelated Git checkout");
  return directory;
}

export class GistGit {
  private readonly root: string;
  private readonly token: string | null | undefined;
  private readonly remoteUrl: (id: string) => string;

  constructor(
    root: string,
    token?: string | null,
    remoteUrl = (id: string) => `https://gist.github.com/${id}.git`,
  ) {
    this.root = root;
    this.token = token;
    this.remoteUrl = remoteUrl;
  }

  private async locked<T>(id: string, action: (directory: string) => Promise<T>): Promise<T> {
    const directory = gistPath(this.root, id);
    return withWorkspaceLock(
      async () => {
        try {
          return await action(gistPath(this.root, id));
        } catch (error) {
          throw new Error(firstErrorLine(error, this.token));
        }
      },
      { env: { REPOTRUCK_CONFIG_DIR: path.dirname(directory) }, lockName: `gist-${id}` },
    );
  }

  private async checkout(directory: string, id: string): Promise<Git> {
    if (inspectGitDotEntry(directory).kind !== "repo") {
      throw new Error("Gist destination is occupied by an unrelated directory");
    }
    workspacePath(directory, ".git");
    const url = this.remoteUrl(id);
    const git = gitWithTokenAuth(directory, url, this.token);
    const root = (await git.raw(["rev-parse", "--show-toplevel"])).trim();
    if (realpathSync(root) !== realpathSync(directory)) {
      throw new Error("Gist destination is occupied by an unrelated checkout");
    }
    const remote = (await git.raw(["remote", "get-url", "--all", "origin"])).trim();
    if (remote !== url) throw new Error("Gist origin does not match the expected checkout");
    return git;
  }

  private async fetch(git: Git, id: string): Promise<string> {
    const branch = (await git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
    const remote = (await git.raw(["config", "--get", `branch.${branch}.remote`])).trim();
    const trackingRef = (await git.raw(["config", "--get", `branch.${branch}.merge`])).trim();
    if (
      remote !== "origin" ||
      !trackingRef.startsWith("refs/heads/") ||
      trackingRef.includes("\n")
    ) {
      throw new Error("Check out a branch with an upstream on the Gist origin");
    }
    await git.raw(["check-ref-format", trackingRef]);
    await git.raw([
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      "--",
      this.remoteUrl(id),
      trackingRef,
    ]);
    return trackingRef;
  }

  async status(id: string): Promise<GistLocalState> {
    try {
      const directory = gistPath(this.root, id);
      if (!existsSync(directory)) return "missing";
      const git = await this.checkout(directory, id);
      return (await git.raw(["status", "--porcelain"])).trim() ? "dirty" : "clean";
    } catch {
      return "invalid";
    }
  }

  async localPath(id: string): Promise<string> {
    const directory = gistPath(this.root, id);
    if (!existsSync(directory)) throw new Error("Clone the Gist before opening it");
    try {
      await this.checkout(directory, id);
    } catch {
      throw new Error("Gist checkout is invalid or has a different origin");
    }
    return directory;
  }

  async sync(id: string): Promise<"cloned" | "updated" | "current" | "ahead"> {
    return this.locked(id, async (directory) => {
      if (!existsSync(directory)) {
        const url = this.remoteUrl(id);
        const result = await cloneOrUpdate(
          { owner: "gist", name: id, httpsUrl: url, sshUrl: url, destDir: directory },
          { token: this.token, preferSsh: false },
        );
        if (result.phase !== "done") throw new Error(result.message ?? "Gist clone failed");
        return "cloned";
      }
      const git = await this.checkout(directory, id);
      if ((await git.raw(["status", "--porcelain"])).trim()) {
        throw new Error("Dirty Gist checkout; commit or stash changes before syncing");
      }
      await this.fetch(git, id);
      const [ahead, behind] = await this.distance(git);
      if (ahead && behind)
        throw new Error("Gist history diverged; resolve it in Git before syncing");
      if (ahead) return "ahead";
      if (!behind) return "current";
      await git.raw(["merge", "--ff-only", "FETCH_HEAD"]);
      return "updated";
    });
  }

  async push(id: string): Promise<"pushed" | "current"> {
    return this.locked(id, async (directory) => {
      if (!existsSync(directory)) throw new Error("Clone the Gist before pushing");
      const git = await this.checkout(directory, id);
      const ref = await this.fetch(git, id);
      const [ahead, behind] = await this.distance(git);
      if (behind) throw new Error("Gist upstream has new commits; reconcile them before pushing");
      if (!ahead) return "current";
      await git.raw(["push", "--recurse-submodules=no", "--", this.remoteUrl(id), `HEAD:${ref}`]);
      return "pushed";
    });
  }

  private async distance(git: Git): Promise<[number, number]> {
    const values = (
      await git.raw(["rev-list", "--left-right", "--count", "HEAD...FETCH_HEAD"])
    ).trim();
    const [ahead, behind] = values.split(/\s+/).map(Number);
    if (
      ahead === undefined ||
      behind === undefined ||
      !Number.isSafeInteger(ahead) ||
      !Number.isSafeInteger(behind)
    ) {
      throw new Error("Could not compare local and upstream Gist commits");
    }
    return [ahead, behind];
  }
}
