import { existsSync } from "node:fs";
import path from "node:path";
import { setWorkspaceAlias } from "../../core/aliases.ts";
import {
  type CustomPreset,
  isInternalOwner,
  type PresetRef,
  targetSegmentsForPreset,
} from "../../presets/index.ts";
import type { EmitProgress } from "../../services/cloner.ts";
import { firstErrorLine } from "../../services/cloner.ts";
import type { RepoInventoryEntry } from "../../services/config.ts";
import type { RepoInfo } from "../../services/github.ts";
import { resolveRepoRef, runAppInRepo, type SpawnImpl } from "../../services/launcher.ts";
import { validateMoveDestination } from "../../services/mover.ts";
import type { ReorganizeResult } from "../../services/reorganizer.ts";
import { readSettings, validateRootInput, writeSettings } from "../../services/settings.ts";
import { parseGitUrl } from "../../services/singleCloner.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { resolveWorkspaceRoot } from "../../services/workspaceRegistry.ts";
import {
  createRepoWorktree,
  listRepoWorktrees,
  type RepoWorktreeDetail,
  removeRepoWorktree,
} from "../../services/worktree.ts";
import type { PreviewTreeEntry } from "../windowing.ts";
import type { ResolvedStoreDeps } from "./defaults.ts";
import { repoKey, validateCreateDraft } from "./filters.ts";
import type { Store } from "./Store.ts";
import type { CreateDraft, GithubClient, StatusPhase, UndoAction } from "./types.ts";

export async function findTrackedEntryInRoot(
  root: string,
  key: string,
): Promise<RepoInventoryEntry | null> {
  const config = await loadWorkspace(root);
  const [owner, name, ...rest] = key.split("/");
  if (owner === undefined || name === undefined || rest.length > 0) return null;
  return (
    config.repos.find(
      (item) =>
        item.owner.toLowerCase() === owner.toLowerCase() &&
        item.name.toLowerCase() === name.toLowerCase() &&
        typeof item.relativePath === "string",
    ) ?? null
  );
}

export async function resolveCurrentAliasFor(root: string, key: string): Promise<string | null> {
  const entry = await findTrackedEntryInRoot(root, key);
  if (entry === null) return null;
  try {
    const config = await loadWorkspace(root);
    for (const [alias, target] of Object.entries(config.aliases ?? {})) {
      if (target.toLowerCase() === entry.relativePath.toLowerCase()) return alias;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function performSubmitAlias(
  root: string,
  key: string,
  alias: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await setWorkspaceAlias(root, alias, key);
    if (!res.ok) return { ok: false, error: res.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function performRunOpenApp(
  root: string,
  key: string,
  appName: string,
  deps: ResolvedStoreDeps,
): Promise<{ code: number; error?: string }> {
  const resolved = await deps.resolveAppFn(appName);
  if (resolved === null) {
    return { code: 1, error: `unknown app: ${appName}` };
  }
  const config = await loadWorkspace(root);
  const options: { spawnImpl?: SpawnImpl } =
    deps.spawnImpl !== undefined ? { spawnImpl: deps.spawnImpl } : {};
  const result = await runAppInRepo(
    { root, config, ref: key, app: resolved, mode: "attached-resume" },
    options,
  );
  return {
    code: result.code ?? 1,
    ...(result.message !== undefined && !result.ok ? { error: result.message } : {}),
  };
}

export async function performSubmitRoot(
  input: string,
): Promise<{ ok: true; nextRoot: string } | { ok: false; error: string }> {
  const validated = validateRootInput(input, process.env);
  if (!validated.ok) return { ok: false, error: validated.error };
  const settings = await readSettings(process.env);
  await writeSettings(process.env, { ...settings, defaultRoot: validated.root });
  const walked = await resolveWorkspaceRoot(process.cwd());
  const nextRoot = walked.found ? walked.root : validated.root;
  return { ok: true, nextRoot };
}

export async function buildPreviewEntries(params: {
  root: string;
  chosen: readonly RepoInfo[];
  preset: PresetRef;
  orgs: readonly string[];
  userLogin: string;
  customPresets: readonly CustomPreset[];
}): Promise<PreviewTreeEntry[]> {
  const config = await loadWorkspace(params.root, params.preset);
  return params.chosen.map((repo) => {
    const internal = isInternalOwner(repo.owner, params.userLogin, [...params.orgs]);
    const relPath = targetSegmentsForPreset(
      repo,
      params.preset,
      internal,
      params.customPresets,
    ).join("/");
    const tracked = config.repos.find(
      (item) =>
        item.owner.toLowerCase() === repo.owner.toLowerCase() &&
        item.name.toLowerCase() === repo.name.toLowerCase(),
    );
    return {
      key: repoKey(repo),
      relPath,
      exists: existsSync(path.join(params.root, ...relPath.split("/"))),
      ...(tracked?.custom === true ? { custom: true } : {}),
    };
  });
}

export async function computeReorganizePreview(
  root: string,
  target: PresetRef,
  keepCustom: boolean,
  customPresets: readonly CustomPreset[],
  reorganize: ResolvedStoreDeps["reorganize"],
): Promise<ReorganizeResult> {
  try {
    return await reorganize(root, target, { dryRun: true, keepCustom, customPresets });
  } catch (error) {
    return {
      moved: [],
      skipped: [],
      failed: [{ key: "preview", message: firstErrorLine(error) }],
      collisions: [],
    };
  }
}

export async function performSubmitClone(params: {
  url: string;
  running: boolean;
  github: GithubClient | null;
  root: string;
  userLogin: string;
  orgs: readonly string[];
  token: string | null;
  preset: PresetRef;
  emit: EmitProgress;
  cloneSingle: ResolvedStoreDeps["cloneSingle"];
}): Promise<{ ok: true; repo?: RepoInfo } | { ok: false; error?: string }> {
  if (parseGitUrl(params.url) === null) {
    return {
      ok: false,
      error: "invalid GitHub repository URL (expected owner/repo or a github.com URL)",
    };
  }
  if (params.running) return { ok: false };
  if (params.github === null) return { ok: false, error: "not initialized" };
  const cloned = await params.cloneSingle(params.url, {
    root: params.root,
    github: params.github,
    userLogin: params.userLogin,
    orgs: [...params.orgs],
    token: params.token,
    presetOverride: params.preset,
    emit: params.emit,
  });
  return { ok: true, ...(cloned?.repo !== undefined ? { repo: cloned.repo } : {}) };
}

export async function performSubmitMove(params: {
  root: string;
  key: string;
  dest: string;
  move: ResolvedStoreDeps["move"];
  pushStatus: (phase: StatusPhase, key: string, message?: string) => void;
  pushUndo: (action: UndoAction) => void;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const validated = validateMoveDestination(params.dest);
  if (validated === null) {
    return { ok: false, error: `invalid destination path: ${params.dest}` };
  }
  const config = await loadWorkspace(params.root);
  const match = resolveRepoRef(config, params.key);
  const result = await params.move(params.root, config, params.key, params.dest, {
    emit: (message) => params.pushStatus("DONE", params.key, message),
  });
  if (!result.ok) return { ok: false, error: result.message };
  if (match !== null) {
    params.pushUndo({
      type: "move",
      key: params.key,
      from: match.entry.relativePath,
      to: validated.join("/"),
      config,
    });
  }
  return { ok: true };
}

export async function performSubmitCreate(params: {
  draft: CreateDraft;
  github: GithubClient | null;
  root: string;
  token: string | null;
  userLogin: string;
  orgs: readonly string[];
  create: ResolvedStoreDeps["create"];
  now: () => string;
  pushStatus: (phase: StatusPhase, key: string, message?: string) => void;
}): Promise<{ ok: true; repo: RepoInfo } | { ok: false; error: string }> {
  const draftError = validateCreateDraft(params.draft);
  if (draftError !== null) return { ok: false, error: draftError };
  if (params.github === null) return { ok: false, error: "not initialized" };
  const config = await loadWorkspace(params.root);
  const { draft } = params;
  const result = await params.create({
    root: params.root,
    config,
    github: params.github,
    token: params.token,
    userLogin: params.userLogin,
    orgs: [...params.orgs],
    options: {
      name: draft.name,
      isPrivate: draft.isPrivate,
      ...(draft.description !== undefined && draft.description.length > 0
        ? { description: draft.description }
        : {}),
      ...(draft.path.length > 0 ? { customPath: draft.path } : {}),
      ...(draft.fromDir !== undefined && draft.fromDir.length > 0
        ? { fromDir: draft.fromDir }
        : {}),
      ...(draft.org !== undefined && draft.org.length > 0 ? { org: draft.org } : {}),
    },
    emit: (message) => params.pushStatus("DONE", draft.name, message),
  });
  if (!result.ok) return { ok: false, error: result.message };
  const owner = draft.org ?? (params.userLogin || "unknown");
  return {
    ok: true,
    repo: {
      owner,
      name: draft.name,
      description: draft.description ?? null,
      isPrivate: draft.isPrivate,
      isFork: false,
      isArchived: false,
      language: null,
      httpsUrl: `https://github.com/${owner}/${draft.name}.git`,
      sshUrl: `git@github.com:${owner}/${draft.name}.git`,
      updatedAt: params.now(),
      stars: 0,
    },
  };
}

export async function performOpenWorktreeModal(
  root: string,
  key: string,
): Promise<RepoWorktreeDetail[]> {
  const config = await loadWorkspace(root);
  const match = resolveRepoRef(config, key);
  if (match === null) {
    throw new Error(`repository not found: ${key}`);
  }
  const repoDir = path.join(root, ...match.entry.relativePath.split("/"));
  return await listRepoWorktrees(repoDir);
}

export async function performCreateWorktree(
  root: string,
  key: string,
  branch: string,
  targetPath?: string,
  newBranch = false,
): Promise<{ ok: boolean; message: string }> {
  const config = await loadWorkspace(root);
  const match = resolveRepoRef(config, key);
  if (match === null) {
    return { ok: false, message: `repository not found: ${key}` };
  }
  const repoDir = path.join(root, ...match.entry.relativePath.split("/"));
  const safeBranch = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
  const destPath =
    targetPath ?? path.join(path.dirname(repoDir), `${match.entry.name}+${safeBranch}`);
  return await createRepoWorktree(repoDir, branch, destPath, { newBranch });
}

export async function performRemoveWorktree(
  root: string,
  key: string,
  targetPath: string,
  force = false,
): Promise<{ ok: boolean; message: string }> {
  const config = await loadWorkspace(root);
  const match = resolveRepoRef(config, key);
  if (match === null) {
    return { ok: false, message: `repository not found: ${key}` };
  }
  const repoDir = path.join(root, ...match.entry.relativePath.split("/"));
  return await removeRepoWorktree(repoDir, targetPath, force);
}

function currentHighlightedKey(store: Store): string | null {
  const snap = store.getSnapshot();
  const repo = snap.filteredRepos[snap.cursor];
  return repo !== undefined ? repoKey(repo) : null;
}

export function executeOmnibarCommandById(store: Store, id: string): void {
  if (id === "mode-symbols") {
    store.openOmnibar("symbols", "");
    return;
  }
  if (id === "mode-github") {
    store.openOmnibar("github", "");
    return;
  }
  if (id === "mode-runner") {
    store.openOmnibar("runner", "");
    return;
  }

  store.closeModal();
  const snap = store.getSnapshot();

  switch (id) {
    case "sync":
      void store.openStartPreview();
      return;
    case "clone":
      store.openCloneModal();
      return;
    case "create":
      store.openCreateModal();
      return;
    case "scan":
      void store.runWorkspaceMaintenance("scan");
      return;
    case "refresh":
      void store.init();
      return;
    case "open": {
      const key = currentHighlightedKey(store);
      if (key !== null) void store.openOpenModal(key);
      else store.pushStatus("FAILED", "[open]", "no repository highlighted");
      return;
    }
    case "detail": {
      const key = currentHighlightedKey(store);
      if (key !== null) store.openDetailModal(key);
      else store.pushStatus("FAILED", "[detail]", "no repository highlighted");
      return;
    }
    case "worktree": {
      const key = currentHighlightedKey(store);
      if (key !== null) void store.openWorktreeModal(key);
      else store.pushStatus("FAILED", "[worktree]", "no repository highlighted");
      return;
    }
    case "move": {
      const key = currentHighlightedKey(store);
      if (key !== null) void store.openMoveModal(key);
      else store.pushStatus("FAILED", "[move]", "no repository highlighted");
      return;
    }
    case "alias": {
      const key = currentHighlightedKey(store);
      if (key !== null) void store.openAliasModal(key);
      else store.pushStatus("FAILED", "[alias]", "no repository highlighted");
      return;
    }
    case "pin":
      void store.togglePinSelection();
      return;
    case "select-toggle":
      store.toggleCurrent();
      return;
    case "select-all":
      store.selectAll();
      return;
    case "archive":
      store.openSelectionArchiveConfirm();
      return;
    case "untrack":
      store.openSelectionUntrackConfirm();
      return;
    case "delete":
      void store.openSelectionDeleteConfirm();
      return;
    case "undo":
      void store.undoLast();
      return;
    case "search":
      store.openSearchModal();
      return;
    case "clear-search":
      store.clearSearch();
      return;
    case "health-filter":
      store.cycleHealthFilter();
      return;
    case "health-all":
      store.setHealthFilter("all");
      return;
    case "health-dirty":
      store.setHealthFilter("dirty");
      return;
    case "health-ahead":
      store.setHealthFilter("ahead");
      return;
    case "health-behind":
      store.setHealthFilter("behind");
      return;
    case "health-pinned":
      store.setHealthFilter("pinned");
      return;
    case "health-local":
      store.setHealthFilter("local");
      return;
    case "health-uncloned":
      store.setHealthFilter("uncloned");
      return;
    case "scope-personal":
      store.togglePersonal();
      return;
    case "filter-active":
      store.setFilter("active", !snap.filters.active);
      return;
    case "filter-forks":
      store.setFilter("forks", !snap.filters.forks);
      return;
    case "filter-archived":
      store.setFilter("archived", !snap.filters.archived);
      return;
    case "sort-cycle":
      store.cycleSort();
      return;
    case "sort-reverse":
      store.toggleSortDirection();
      return;
    case "sort-default":
      store.setSortKey("default");
      return;
    case "sort-name":
      store.setSortKey("name");
      return;
    case "sort-language":
      store.setSortKey("language");
      return;
    case "sort-updated":
      store.setSortKey("updatedAt");
      return;
    case "sort-stars":
      store.setSortKey("stars");
      return;
    case "sort-dirty":
      store.setSortKey("dirty");
      return;
    case "tab-activity":
      store.setRightPaneTab("activity");
      return;
    case "tab-inspector":
      store.setRightPaneTab("inspector");
      return;
    case "tab-health":
      store.setRightPaneTab("health");
      return;
    case "focus-cycle":
      store.cycleFocus();
      return;
    case "theme":
      void store.cycleTheme();
      return;
    case "workspaces":
      void store.openWorkspacePicker();
      return;
    case "preset":
      void store.cyclePreset();
      return;
    case "reorganize":
      void store.openReorganizeModal();
      return;
    case "root":
      void store.openRootModal();
      return;
    case "doctor-fix":
      store.setRightPaneTab("health");
      void store.runHealthDoctorFix();
      return;
    case "instructions-sync":
      void store.runWorkspaceMaintenance("instructions");
      return;
    case "code-index":
      void store.runWorkspaceMaintenance("code-index");
      return;
    case "backup-snapshot":
      void store.runWorkspaceMaintenance("backup");
      return;
    case "trash-empty":
      void store.runWorkspaceMaintenance("trash-empty");
      return;
    case "offline":
      void store.enterOfflineMode();
      return;
    case "help":
      store.openHelpModal();
      return;
    default:
      return;
  }
}
