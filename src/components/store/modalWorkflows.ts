import { existsSync } from "node:fs";
import path from "node:path";
import { REGISTRY_BY_ID } from "../../commands/registry.ts";
import { setWorkspaceAlias } from "../../core/aliases.ts";
import type { CustomPreset, PresetRef } from "../../presets/index.ts";
import type { EmitProgress } from "../../services/cloner.ts";
import { createCloneLimiter, firstErrorLine } from "../../services/cloner.ts";
import type { RepoInventoryEntry } from "../../services/config.ts";
import type { RepoLookup } from "../../services/forkSource.ts";
import type { RepoInfo } from "../../services/github.ts";
import { resolveRepoRef } from "../../services/launcher.ts";
import { validateMoveDestination } from "../../services/mover.ts";
import type { ReorganizeResult } from "../../services/reorganizer.ts";
import { readSettings, validateRootInput, writeSettings } from "../../services/settings.ts";
import { parseGitUrl } from "../../services/singleCloner.ts";
import {
  loadWorkspace,
  resolveForkPlacementRepo,
  resolveRepoPlacement,
} from "../../services/workspace.ts";
import { VIEW_BY_ID } from "../views/viewRegistry.ts";
import type { PreviewTreeEntry } from "../windowing.ts";
import type { ResolvedStoreDeps } from "./defaults.ts";
import { repoKey, validateCreateDraft } from "./filters.ts";
import type { Store } from "./Store.ts";
import type { CreateDraft, GithubClient, StatusPhase, UndoAction, ViewId } from "./types.ts";

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

export async function performSubmitRoot(
  input: string,
): Promise<{ ok: true; nextRoot: string } | { ok: false; error: string }> {
  const validated = validateRootInput(input, process.env);
  if (!validated.ok) return { ok: false, error: validated.error };
  const settings = await readSettings(process.env);
  await writeSettings(process.env, { ...settings, defaultRoot: validated.root });
  return { ok: true, nextRoot: validated.root };
}

export async function buildPreviewEntries(params: {
  root: string;
  chosen: readonly RepoInfo[];
  preset: PresetRef;
  orgs: readonly string[];
  userLogin: string;
  customPresets: readonly CustomPreset[];
  getRepo?: RepoLookup;
}): Promise<PreviewTreeEntry[]> {
  const config = await loadWorkspace(params.root, params.preset);
  const limit = createCloneLimiter(4);
  return await Promise.all(
    params.chosen.map((candidate) =>
      limit(async () => {
        const repo = await resolveForkPlacementRepo(candidate, config, params.getRepo);
        const { relativePath: relPath, tracked } = resolveRepoPlacement(
          config,
          repo,
          params.userLogin,
          params.orgs,
          params.customPresets,
        );
        return {
          key: repoKey(repo),
          relPath,
          exists: existsSync(path.join(params.root, ...relPath.split("/"))),
          ...(tracked?.custom === true ? { custom: true } : {}),
        };
      }),
    ),
  );
}

export async function computeReorganizePreview(
  root: string,
  target: PresetRef,
  keepCustom: boolean,
  customPresets: readonly CustomPreset[],
  reorganize: ResolvedStoreDeps["reorganize"],
  scan = false,
  getRepo?: RepoLookup,
): Promise<ReorganizeResult> {
  try {
    return await reorganize(root, target, {
      dryRun: true,
      keepCustom,
      customPresets,
      scan,
      getRepo,
    });
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

/**
 * Dispatch a registry command selected from the palette. Surfaces already
 * implemented navigate/open; planned tickets log their arrival notice so
 * every CLI command is at least reachable and honest about its state.
 */
export function executeRegistryCommand(store: Store, registryId: string, preferForm = true): void {
  const spec = REGISTRY_BY_ID.get(registryId);
  if (spec === undefined) {
    store.pushStatus("FAILED", "[palette]", `unknown command: ${registryId}`);
    return;
  }
  // Flag-bearing commands open the auto-generated command form first so
  // every flag is reachable; the form keeps the direct surface one button
  // away. Action surfaces (confirm flows) and no-flag commands dispatch
  // directly.
  if (
    preferForm &&
    spec.flags.length > 0 &&
    spec.surface.kind !== "action" &&
    spec.id !== "__globals__"
  ) {
    store.openCommandForm(spec.id);
    return;
  }
  store.closeModal();

  if (spec.surface.kind === "view") {
    store.setView(spec.surface.view);
    return;
  }
  if (spec.surface.kind === "planned") {
    store.pushStatus("DONE", `[${spec.path}]`, `arriving with ${spec.surface.ticket}`);
    return;
  }
  if (spec.surface.kind === "action") {
    switch (spec.surface.action) {
      case "openSelectionUntrackConfirm":
        store.openSelectionUntrackConfirm();
        return;
      case "openSelectionDeleteConfirm":
        void store.openSelectionDeleteConfirm();
        return;
      case "openSelectionArchiveConfirm":
        store.openSelectionArchiveConfirm();
        return;
      case "togglePinSelection":
        void store.togglePinSelection();
        return;
      case "runHealthDoctorFix":
        void store.runHealthDoctorFix();
        return;
      case "trash-empty":
        store.trashEmptyConfirm();
        return;
      default:
        store.pushStatus("FAILED", `[${spec.path}]`, "action surface not wired yet");
        return;
    }
  }
  // modal surfaces
  const key = currentHighlightedKey(store);
  const needsRepo = (name: string): boolean => ["move", "alias", "open", "worktree"].includes(name);
  if (needsRepo(spec.surface.modal) && key === null) {
    store.pushStatus("FAILED", `[${spec.path}]`, "no repository highlighted");
    return;
  }
  switch (spec.surface.modal) {
    case "clone":
      store.openCloneModal();
      return;
    case "deviceFlow":
      void store.startDeviceFlow();
      return;
    case "create":
      store.openCreateModal();
      return;
    case "workspaces":
      void store.openWorkspacePicker();
      return;
    case "root":
      void store.openRootModal();
      return;
    case "reorganize":
      void store.openReorganizeModal();
      return;
    case "move":
      if (key !== null) void store.openMoveModal(key);
      return;
    case "alias":
      if (key !== null) void store.openAliasModal(key);
      return;
    case "open":
      if (key !== null) void store.openOpenModal(key);
      return;
    case "worktree":
      if (key !== null) void store.openWorktreeModal(key);
      return;
    default:
      store.pushStatus("DONE", `[${spec.path}]`, "modal surface not wired yet");
  }
}

function currentHighlightedKey(store: Store): string | null {
  const snap = store.getSnapshot();
  const repo = snap.filteredRepos[snap.cursor];
  return repo !== undefined ? repoKey(repo) : null;
}

export function executeOmnibarCommandById(store: Store, id: string): void {
  if (id.startsWith("cmd:")) {
    executeRegistryCommand(store, id.slice("cmd:".length));
    return;
  }
  if (id.startsWith("view:")) {
    const target = id.slice("view:".length) as ViewId;
    store.closeModal();
    if (VIEW_BY_ID.has(target)) {
      store.setView(target);
    } else {
      store.pushStatus("FAILED", "[omnibar]", `unknown view: ${target}`);
    }
    return;
  }
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
      store.trashEmptyConfirm();
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

// Re-exported for existing import sites; implementations moved for the size budget.
export {
  performCreateWorktree,
  performOpenWorktreeModal,
  performRemoveWorktree,
  performRunOpenApp,
} from "./worktreeWorkflows.ts";
