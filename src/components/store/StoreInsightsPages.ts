import { existsSync } from "node:fs";
import path from "node:path";
import { formatChangelogMarkdown, getWorkspaceChangelog } from "../../services/changelog.ts";
import { computeWorkspaceHealthScore } from "../../services/healthScore.ts";
import { pruneWorkspace } from "../../services/lifecycle.ts";
import {
  adoptUnregisteredRepos,
  buildAdoptPlan,
  scanWorkspaceRepos,
} from "../../services/scanner.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { listRepoWorktrees } from "../../services/worktree.ts";
import { loadWorkspaceHealthData } from "./gitHealth.ts";
import { StoreAbout } from "./StoreAbout.ts";

export class StoreInsightsPages extends StoreAbout {
  // ---- Changelog (t17) -------------------------------------------------------------
  generateChangelog = async (options: {
    since?: string;
    until?: string;
    author?: string;
    repoRef?: string;
  }): Promise<void> => {
    const operation = this.workspaceOperation("generateChangelog");
    const { set: update, pushStatus } = operation;
    try {
      try {
        const config = this.localConfig ?? (await loadWorkspace(operation.root));
        if (!operation.current()) return;
        this.localConfig = config;
        const changelogs = await getWorkspaceChangelog(operation.root, config, options);
        const since = options.since ?? "7 days ago";
        const markdown = formatChangelogMarkdown(changelogs, since);
        update({ changelogPage: { markdown } });
        pushStatus("DONE", "[changelog]", `${changelogs.length} repos with commits since ${since}`);
      } catch (error) {
        pushStatus("FAILED", "[changelog]", error instanceof Error ? error.message : String(error));
      }
    } finally {
      operation.finish();
    }
  };

  // ---- Scan & adopt + prune (t17) ---------------------------------------------------
  scanAndAdopt = async (adopt: boolean): Promise<void> => {
    const operation = this.workspaceOperation("scanAndAdopt");
    const { set: update, pushStatus } = operation;
    try {
      try {
        const config = this.localConfig ?? (await loadWorkspace(operation.root));
        if (!operation.current()) return;
        this.localConfig = config;
        const result = await scanWorkspaceRepos(operation.root, config);
        if (!operation.current()) return;
        if (!adopt) {
          const lines = result.unregistered.map(
            (repo) =>
              `${repo.owner}/${repo.name} · ${repo.relativePath}${repo.internal ? "" : " (external)"}`,
          );
          update({ scanPage: { unregistered: lines } });
          pushStatus(
            "DONE",
            "[scan]",
            `scanned ${result.allDiscovered.length} repositories (${result.tracked.length} tracked, ${result.unregistered.length} unregistered)`,
          );
          return;
        }
        const plans = buildAdoptPlan(
          operation.root,
          config,
          result.unregistered,
          this.state.customPresets,
        );
        const execution = await adoptUnregisteredRepos(operation.root, config, plans);
        pushStatus(
          execution.errors.length > 0 ? "FAILED" : "DONE",
          "[scan]",
          `adopted ${execution.adopted.length}, ${execution.errors.length} errors${execution.errors.length > 0 ? ` (${execution.errors[0]?.error})` : ""}`,
        );
        if (operation.current()) await this.refreshLocalState();
      } catch (error) {
        pushStatus("FAILED", "[scan]", error instanceof Error ? error.message : String(error));
      }
    } finally {
      operation.finish();
    }
  };

  pruneWorkspaceConfirm = (): void => {
    const root = this.rootValue,
      client = this.github;
    this.confirmDialog(
      {
        title: "Prune repositories",
        message:
          "Untrack repositories GitHub answers 404 for? Unclear answers (network/permission) are kept and reported.",
        confirmLabel: "Prune",
        danger: true,
      },
      () => {
        void (async () => {
          try {
            if (root !== this.rootValue) return;
            const config = this.localConfig ?? (await loadWorkspace(root));
            if (client === null) throw new Error("not initialized");
            const github = {
              getRepo: async (owner: string, name: string) => client.getRepo(owner, name),
              archiveRepo: async (owner: string, name: string) => {
                if (client.archiveRepo === undefined) throw new Error("archive unavailable");
                return await client.archiveRepo(owner, name);
              },
            };
            const result = await pruneWorkspace(root, config, github);
            if (root !== this.rootValue) return;
            this.pushStatus(result.ok ? "DONE" : "FAILED", "[prune]", result.message);
            await this.refreshLocalState();
          } catch (error) {
            if (root !== this.rootValue) return;
            this.pushStatus(
              "FAILED",
              "[prune]",
              error instanceof Error ? error.message : String(error),
            );
          }
        })();
      },
    );
  };

  // ---- Worktree scan (t18) -----------------------------------------------------------
  scanWorkspaceWorktrees = async (): Promise<void> => {
    const operation = this.workspaceOperation("scanWorkspaceWorktrees");
    const { set: update, pushStatus } = operation;
    try {
      try {
        const config = this.localConfig ?? (await loadWorkspace(operation.root));
        if (!operation.current()) return;
        this.localConfig = config;
        const rows: { repo: string; branch: string | null; path: string }[] = [];
        for (const entry of config.repos) {
          const dir = path.join(operation.root, ...entry.relativePath.split("/"));
          if (!existsSync(dir)) continue;
          const worktrees = await listRepoWorktrees(dir);
          for (const worktree of worktrees) {
            if (worktree.isMain) continue;
            rows.push({
              repo: `${entry.owner}/${entry.name}`,
              branch: worktree.branch,
              path: worktree.path,
            });
          }
        }
        update({ worktreePage: { rows } });
        pushStatus(
          "DONE",
          "[worktree]",
          rows.length === 0
            ? "no linked worktrees discovered in workspace"
            : `${rows.length} linked worktree(s) discovered`,
        );
      } catch (error) {
        pushStatus("FAILED", "[worktree]", error instanceof Error ? error.message : String(error));
      }
    } finally {
      operation.finish();
    }
  };

  // ---- Stats page (t08) ------------------------------------------------------
  refreshStatsPage = async (): Promise<void> => {
    const operation = this.workspaceOperation("refreshStatsPage");
    const { set: update } = operation;
    try {
      update({
        statsPage: {
          loading: true,
          stats: this.state.statsPage?.stats ?? null,
          health: this.state.statsPage?.health ?? null,
          checks: this.state.statsPage?.checks ?? [],
        },
      });
      try {
        const config = this.localConfig ?? (await loadWorkspace(operation.root));
        if (!operation.current()) return;
        this.localConfig = config;
        const health = await loadWorkspaceHealthData(operation.root, config);
        const score = await computeWorkspaceHealthScore(operation.root, config);
        update({
          statsPage: { loading: false, stats: health.stats, health: score, checks: health.checks },
        });
      } catch {
        update({ statsPage: { loading: false, stats: null, health: null, checks: [] } });
      }
    } finally {
      operation.finish();
    }
  };
}
