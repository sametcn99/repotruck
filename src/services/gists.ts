import { createCloneLimiter, firstErrorLine } from "./cloner.ts";
import type { EnvLike } from "./config.ts";
import {
  type GistApi,
  type GistCreate,
  type GistDetail,
  type GistEdit,
  type GistInfo,
  gistId,
  gistSummary,
} from "./gistApi.ts";
import { GistGit, type GistLocalState, gistPath } from "./gistGit.ts";
import { loadWorkspace, updateWorkspace } from "./workspace.ts";
import { withWorkspaceLock } from "./workspaceLock.ts";

export interface GistSession {
  gists?: Pick<GistApi, "list" | "get" | "create" | "edit" | "delete">;
  getUserLogin(): Promise<string>;
}

export interface GistRow {
  id: string;
  gist: GistInfo | null;
  tracked: boolean;
  local: GistLocalState;
}

type GistFailureStage = "lookup" | "checkout";

export interface GistSyncItem {
  id: string;
  action?: Awaited<ReturnType<GistGit["sync"]>>;
  error?: string;
  stage?: GistFailureStage;
}

type AutoSyncResult = {
  synced: number;
  failed: number;
  ahead: number;
  errors?: Partial<Record<GistFailureStage, number>>;
  error?: string;
};

interface GistServiceOptions {
  root: string;
  env?: EnvLike;
  github?: GistSession | null;
  login?: string | null;
  token?: string | null;
  git?: GistGit;
}

export class GistService {
  private readonly git: GistGit;
  private readonly options: GistServiceOptions;

  constructor(options: GistServiceOptions) {
    this.options = options;
    this.git = options.git ?? new GistGit(options.root, options.token);
  }

  private api(): NonNullable<GistSession["gists"]> {
    const api = this.options.github?.gists;
    if (!api) throw new Error("Sign in to GitHub.com to use remote Gist operations");
    return api;
  }

  private async login(): Promise<string> {
    const login = this.options.login ?? (await this.options.github?.getUserLogin());
    if (!login) throw new Error("Sign in to GitHub.com to manage account Gists");
    return login;
  }

  private async tracked(): Promise<string[]> {
    const config = await loadWorkspace(this.options.root, undefined, this.options.env);
    return (config.gists ?? []).map(({ id }) => id);
  }

  private async track(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const { root, env } = this.options;
    const known = new Set(await this.tracked());
    if (ids.every((id) => known.has(id))) return;
    await updateWorkspace(
      root,
      (config) => ({
        config: {
          ...config,
          gists: [...new Set([...(config.gists ?? []).map(({ id }) => id), ...ids])].map((id) => ({
            id,
          })),
        },
        result: undefined,
      }),
      env,
    );
  }

  async list(trackedOnly = false): Promise<GistRow[]> {
    const tracked = new Set(await this.tracked());
    const owned = trackedOnly ? [] : await this.api().list(await this.login());
    const rows = new Map<string, GistInfo | null>(owned.map((gist) => [gist.id, gist]));
    for (const id of tracked) if (!rows.has(id)) rows.set(id, null);
    const limit = createCloneLimiter(4);
    return Promise.all(
      [...rows].map(([id, gist]) =>
        limit(async () => ({
          id,
          gist:
            gist ??
            (trackedOnly
              ? null
              : await this.api()
                  .get(id)
                  .then(gistSummary)
                  .catch(() => null)),
          tracked: tracked.has(id),
          local: await this.git.status(id),
        })),
      ),
    );
  }

  async show(ref: string): Promise<GistDetail> {
    return this.api().get(gistId(ref));
  }

  async localPath(ref: string): Promise<string> {
    const id = gistId(ref);
    if (!(await this.tracked()).includes(id)) throw new Error("Clone the Gist before opening it");
    return this.git.localPath(id);
  }

  async sync(
    refs: readonly string[] = [],
    options: { ownedOnly?: boolean; concurrency?: number } = {},
  ): Promise<GistSyncItem[]> {
    const api = this.api();
    const ids = refs.map(gistId);
    const owned = ids.length > 0 ? [] : await api.list(await this.login());
    const tracked = ids.length > 0 || options.ownedOnly ? [] : await this.tracked();
    const known = new Set(owned.map(({ id }) => id));
    const targets = new Set([...ids, ...known, ...tracked]);
    const limit = createCloneLimiter(options.concurrency ?? 3);
    const results = await Promise.all(
      [...targets].map((id) =>
        limit(async () => {
          let stage: GistFailureStage = "lookup";
          try {
            if (!known.has(id)) await api.get(id);
            stage = "checkout";
            return { id, action: await this.git.sync(id) };
          } catch (error) {
            return { id, error: firstErrorLine(error, this.options.token), stage };
          }
        }),
      ),
    );
    await this.track(results.flatMap((item) => (item.action ? [item.id] : [])));
    return results;
  }

  async create(input: GistCreate): Promise<{ gist: GistInfo; local: GistSyncItem }> {
    const gist = await this.api().create(input);
    try {
      const action = await this.git.sync(gist.id);
      await this.track([gist.id]);
      return { gist, local: { id: gist.id, action } };
    } catch (error) {
      return { gist, local: { id: gist.id, error: firstErrorLine(error, this.options.token) } };
    }
  }

  private async owned(ref: string): Promise<GistDetail> {
    const gist = await this.show(ref);
    if (gist.owner?.toLowerCase() !== (await this.login()).toLowerCase()) {
      throw new Error("Only the Gist owner can modify it");
    }
    return gist;
  }

  private async mutate<T>(ref: string, action: (gist: GistDetail) => Promise<T>): Promise<T> {
    const id = gistId(ref);
    return withWorkspaceLock(async () => action(await this.owned(id)), {
      env: this.options.env,
      lockName: `remote-gist-${id}`,
    });
  }

  async edit(ref: string, input: GistEdit): Promise<{ gist: GistInfo; syncNeeded: boolean }> {
    return this.mutate(ref, async (current) => {
      if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
        throw new Error("The Gist changed on GitHub; reopen it before editing");
      }
      const syncNeeded = (await this.tracked()).includes(current.id);
      const gist = await this.api().edit(current, input);
      return { gist, syncNeeded };
    });
  }

  async push(ref: string) {
    return this.mutate(ref, async (gist) => {
      if (!(await this.tracked()).includes(gist.id))
        throw new Error("Clone the Gist before pushing");
      return { id: gist.id, action: await this.git.push(gist.id) };
    });
  }

  async delete(ref: string, confirm: boolean): Promise<{ id: string; localPath: string | null }> {
    if (!confirm) throw new Error("Confirm permanent deletion from GitHub");
    return this.mutate(ref, async (gist) => {
      const localPath = (await this.tracked()).includes(gist.id)
        ? gistPath(this.options.root, gist.id)
        : null;
      await this.api().delete(gist.id);
      return { id: gist.id, localPath };
    });
  }
}

export function autoGistsEnabled(options: {
  includeGists?: boolean;
  scope: string;
  targeted?: boolean;
}): boolean {
  return (
    options.includeGists !== false &&
    !options.targeted &&
    (options.scope === "user" || options.scope === "all")
  );
}

export async function syncWorkspaceGists(
  options: GistServiceOptions & { concurrency?: number },
): Promise<AutoSyncResult | undefined> {
  if (!options.github?.gists) return undefined;
  try {
    const results = await new GistService(options).sync([], {
      ownedOnly: true,
      concurrency: options.concurrency,
    });
    const errors: NonNullable<AutoSyncResult["errors"]> = {};
    for (const { stage } of results) {
      if (stage) errors[stage] = (errors[stage] ?? 0) + 1;
    }
    return {
      ...(Object.keys(errors).length ? { errors } : {}),
      synced: results.filter((item) => item.action && item.action !== "ahead").length,
      ahead: results.filter((item) => item.action === "ahead").length,
      failed: results.filter((item) => item.error).length,
    };
  } catch {
    return {
      synced: 0,
      ahead: 0,
      failed: 1,
      error:
        "Gist discovery or inventory update failed; check Gist access and retry from the Gists view",
    };
  }
}

export function gistSyncSummary(result: AutoSyncResult): string {
  const detail =
    result.error ??
    Object.entries(result.errors ?? {})
      .map(([stage, count]) => `${stage}: ${count}`)
      .join(", ");
  return `Gists: ${result.synced} synced, ${result.ahead} ahead, ${result.failed} failed${detail ? ` (${detail})` : ""}`;
}
