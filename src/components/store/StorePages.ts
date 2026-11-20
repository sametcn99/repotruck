import { deleteWorkspaceProfile, saveWorkspaceProfile } from "../../core/profiles.ts";
import { validateCustomPreset } from "../../presets/index.ts";
import type { GenerateAgentsMdInput } from "../../services/agentsMd.ts";
import { exportInstructionsFile } from "../../services/instructionExport.ts";
import { readSettings, writeSettings } from "../../services/settings.ts";
import { applyAgentsMdTemplate, clearAgentsMdTemplate } from "../../services/templates.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { tokenizeCommandLine } from "./lifecycleActions.ts";
import { StoreDataPages } from "./StoreDataPages.ts";

/**
 * Configuration & tooling page actions — Settings & device flow, Presets,
 * Profiles, Agents & MCP, Code Search and the Run Console — continuing the
 * store class chain for the file-size budget. `Store` extends this class.
 */
export class StorePages extends StoreDataPages {
  // ---- Settings page (t10) ---------------------------------------------------
  startDeviceFlow = async (): Promise<void> => {
    if (this.state.deviceFlow?.waiting === true) return;
    if ((process.env.REPOTRUCK_TOKEN ?? "").length > 0) {
      this.pushStatus(
        "FAILED",
        "[auth]",
        "already logged in (method: env) — unset REPOTRUCK_TOKEN to use the device flow",
      );
      return;
    }
    this.openModal({ type: "deviceFlow" });
    this.set({
      deviceFlow: {
        loading: true,
        verificationUri: null,
        userCode: null,
        waiting: false,
        error: null,
      },
    });
    try {
      const handle = await this.deps.beginDeviceLoginFn({ env: process.env });
      this.set({
        deviceFlow: {
          loading: false,
          verificationUri: handle.verificationUri,
          userCode: handle.userCode,
          waiting: true,
          error: null,
        },
      });
      // Background poll: abandoning the handle on cancel is safe — a late
      // authorization only writes a valid token into the cache.
      await handle.completion;
      this.set({ deviceFlow: null });
      this.closeModal();
      this.pushStatus("DONE", "[auth]", "logged in via device flow");
      await this.init();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushStatus("FAILED", "[auth]", message);
      this.set({
        deviceFlow: {
          loading: false,
          verificationUri: null,
          userCode: null,
          waiting: false,
          error: message,
        },
      });
    }
  };

  cancelDeviceFlow = (): void => {
    if (this.state.modal?.type === "deviceFlow") this.closeModal();
    if (this.state.deviceFlow !== null) this.set({ deviceFlow: null });
  };

  refreshSettingsPage = async (): Promise<void> => {
    try {
      const settings = await readSettings(process.env);
      const auth = await this.deps.auth().catch(() => null);
      this.set({
        settingsPage: {
          settings,
          authMethod: auth?.method ?? null,
          userLogin: this.userLoginValue,
        },
      });
    } catch {
      this.set({
        settingsPage: { settings: null, authMethod: null, userLogin: this.userLoginValue },
      });
    }
  };

  setSetting = async (key: string, value: string | boolean | number): Promise<void> => {
    try {
      const settings = await readSettings(process.env);
      const next = setNestedSetting(settings, key, value);
      await writeSettings(process.env, next);
      this.pushStatus("DONE", "[config]", `set ${key} = ${String(value)}`);
      await this.refreshSettingsPage();
    } catch (error) {
      this.pushStatus("FAILED", "[config]", error instanceof Error ? error.message : String(error));
    }
  };

  unsetSetting = async (key: string): Promise<void> => {
    try {
      const settings = await readSettings(process.env);
      const next = unsetNestedSetting(settings, key);
      await writeSettings(process.env, next);
      this.pushStatus("DONE", "[config]", `unset ${key}`);
      await this.refreshSettingsPage();
    } catch (error) {
      this.pushStatus("FAILED", "[config]", error instanceof Error ? error.message : String(error));
    }
  };

  resetDefaultRoot = async (): Promise<void> => {
    await this.setSetting("defaultRoot", "");
    await this.unsetSetting("defaultRoot");
    await this.refreshLocalState();
  };

  // ---- Presets page (t11) ------------------------------------------------------
  addCustomPreset = async (id: string, segments: readonly string[]): Promise<void> => {
    const validated = validateCustomPreset({ id, segments: [...segments] });
    if (validated === null) {
      this.pushStatus(
        "FAILED",
        "[preset]",
        "segments must be 1-4 distinct tokens from owner, category, language, name, ending with name",
      );
      return;
    }
    try {
      const settings = await readSettings(process.env);
      await writeSettings(process.env, {
        ...settings,
        presets: { ...(settings.presets ?? {}), [validated.id]: { segments: validated.segments } },
      });
      this.pushStatus("DONE", "[preset]", `${validated.id} -> ${validated.segments.join("/")}`);
      await this.refreshLocalState();
    } catch (error) {
      this.pushStatus("FAILED", "[preset]", error instanceof Error ? error.message : String(error));
    }
  };

  removeCustomPreset = async (id: string): Promise<void> => {
    try {
      const settings = await readSettings(process.env);
      const presets = { ...(settings.presets ?? {}) };
      if (presets[id] === undefined) {
        this.pushStatus("FAILED", "[preset]", `preset not found: ${id}`);
        return;
      }
      delete presets[id];
      await writeSettings(process.env, { ...settings, presets });
      this.pushStatus("DONE", "[preset]", `${id} removed`);
      await this.refreshLocalState();
    } catch (error) {
      this.pushStatus("FAILED", "[preset]", error instanceof Error ? error.message : String(error));
    }
  };

  // ---- Profiles page (t11) ------------------------------------------------------
  profileSaveFromSelection = async (name: string): Promise<void> => {
    try {
      const refs =
        this.state.selected.size > 0
          ? [...this.state.selected]
          : [...this.state.localHealth.entries()].filter(([, h]) => h.pinned).map(([key]) => key);
      const result = await saveWorkspaceProfile(this.rootValue, name, refs);
      this.pushStatus(result.ok ? "DONE" : "FAILED", "[profile]", result.message);
      if (result.ok) await this.refreshLocalState();
    } catch (error) {
      this.pushStatus(
        "FAILED",
        "[profile]",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  profileDelete = async (name: string): Promise<void> => {
    try {
      const result = await deleteWorkspaceProfile(this.rootValue, name);
      this.pushStatus(result.ok ? "DONE" : "FAILED", "[profile]", result.message);
      if (result.ok) await this.refreshLocalState();
    } catch (error) {
      this.pushStatus(
        "FAILED",
        "[profile]",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  // ---- Agents page (t12) ---------------------------------------------------------
  applyAgentsTemplate = async (name: string, clear = false): Promise<void> => {
    try {
      const input = await this.agentsMdInput();
      const templateInput = { ...input, root: this.rootValue };
      const result = clear
        ? await clearAgentsMdTemplate(templateInput)
        : await applyAgentsMdTemplate(templateInput, name);
      this.pushStatus(result.ok ? "DONE" : "FAILED", "[instructions]", result.message);
    } catch (error) {
      this.pushStatus(
        "FAILED",
        "[instructions]",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  exportInstructions = async (
    format: "agents" | "cursor" | "claude" | "copilot",
    outPath?: string,
  ): Promise<void> => {
    try {
      const input = await this.agentsMdInput();
      const result = await exportInstructionsFile(this.rootValue, input, format, outPath);
      this.pushStatus("DONE", "[instructions]", `exported ${format} -> ${result.targetPath}`);
    } catch (error) {
      this.pushStatus(
        "FAILED",
        "[instructions]",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  private async agentsMdInput(): Promise<GenerateAgentsMdInput> {
    const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
    this.localConfig = config;
    return {
      preset: config.preset,
      lastSync: config.lastSync,
      repos: config.repos,
      ...(config.aliases !== undefined ? { aliases: config.aliases } : {}),
      ...(config.pinned !== undefined ? { pinned: config.pinned } : {}),
    };
  }

  startMcpServer = async (port: number): Promise<void> => {
    if (this.taskLabel("mcp") !== null) return;
    try {
      const child = Bun.spawn(
        [process.execPath, process.argv[1] ?? "repotruck", "mcp", "--http", "--port", String(port)],
        { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
      );
      this.beginTask("mcp", `mcp --http --port ${port}`, () => child.kill());
      this.pushStatus("DONE", "[mcp]", `serving on http://127.0.0.1:${port}/mcp`);
    } catch (error) {
      this.pushStatus("FAILED", "[mcp]", error instanceof Error ? error.message : String(error));
    }
  };

  stopMcpServer = (): void => {
    if (this.taskLabel("mcp") === null) return;
    this.cancelTask("mcp");
    this.pushStatus("DONE", "[mcp]", "server stopped");
  };

  // ---- Code Search page (t06) ---------------------------------------------
  updateCodeSearchForm = (partial: Partial<CodeSearchForm>): void => {
    const current = this.state.codeSearchPage ?? defaultCodeSearchForm();
    this.set({ codeSearchPage: { ...current, ...partial } });
  };

  runCodeSearchPage = async (): Promise<void> => {
    const form = this.state.codeSearchPage ?? defaultCodeSearchForm();
    const pattern = form.pattern.trim();
    if (pattern.length === 0) return;
    this.set({ codeSearchPage: { ...form, loading: true } });
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      const result = await this.deps.searchCodeFn({
        root: this.rootValue,
        config,
        pattern,
        ...(form.kind !== "" ? { kind: form.kind } : {}),
        ...(form.lang !== "" ? { lang: form.lang } : {}),
        limit: form.limit,
        offline: form.offline,
        ...(form.mode === "text" ? { text: true } : {}),
        ...(form.mode === "re" ? { regex: true } : {}),
      });
      const guard = this.state.codeSearchPage;
      if (guard !== null)
        this.set({ codeSearchPage: { ...guard, loading: false, matches: result.matches } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushStatus("FAILED", "[search-code]", message);
      const guard = this.state.codeSearchPage;
      if (guard !== null) this.set({ codeSearchPage: { ...guard, loading: false, matches: [] } });
    }
  };

  rebuildCodeIndex = async (): Promise<void> => {
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      await this.deps.searchCodeFn({
        root: this.rootValue,
        config,
        pattern: "",
        rebuild: true,
        offline: true,
      });
      this.pushStatus("DONE", "[search-code]", "symbol index rebuilt");
    } catch (error) {
      this.pushStatus(
        "FAILED",
        "[search-code]",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  // ---- Run Console page (t07) ----------------------------------------------
  updateRunConsole = (partial: Partial<import("./types.ts").RunConsoleState>): void => {
    const current = this.state.runConsole ?? defaultRunConsoleState();
    this.set({ runConsole: { ...current, ...partial } });
  };

  runConsoleStart = async (): Promise<void> => {
    const state = this.state.runConsole ?? defaultRunConsoleState();
    const commandLine = state.command.trim();
    if (commandLine.length === 0 || state.running) return;
    const [command, ...args] = tokenizeCommandLine(commandLine);
    if (command === undefined) return;
    const refs =
      state.scope === "selection"
        ? [...this.state.selected]
        : state.scope === "pinned"
          ? [...this.state.localHealth.entries()].filter(([, h]) => h.pinned).map(([key]) => key)
          : state.scope === "profile"
            ? await profileRefs(this.rootValue, state.profile)
            : [];
    this.set({ runConsole: { ...state, running: true, results: [], skipped: [] } });
    const taskId = "run-console";
    this.beginTask(taskId, "run");
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      const result = await this.deps.runInReposFn({
        root: this.rootValue,
        config,
        refs,
        command,
        args,
        concurrency: state.concurrency,
      });
      const guard = this.state.runConsole;
      if (guard !== null) {
        this.set({
          runConsole: {
            ...guard,
            running: false,
            results: result.results,
            skipped: result.skipped,
          },
        });
      }
      const failed = result.results.filter((r) => !r.ok).length;
      this.endTask(taskId, `${result.results.length} repos · ${failed} failed`, failed > 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.endTask(taskId, message, true);
      const guard = this.state.runConsole;
      if (guard !== null) this.set({ runConsole: { ...guard, running: false } });
    }
  };
}

// ---- page-state helpers ----------------------------------------------------

export interface CodeSearchForm {
  pattern: string;
  mode: "sym" | "text" | "re";
  kind: string;
  lang: string;
  limit: number;
  offline: boolean;
}

export function defaultCodeSearchForm(): import("./types.ts").CodeSearchPageState {
  return {
    loading: false,
    pattern: "",
    mode: "sym",
    kind: "",
    lang: "",
    limit: 50,
    offline: true,
    matches: [],
  };
}

export function defaultRunConsoleState(): import("./types.ts").RunConsoleState {
  return {
    running: false,
    command: "",
    scope: "selection",
    profile: "",
    concurrency: 3,
    results: [],
    skipped: [],
  };
}

async function profileRefs(root: string, profile: string): Promise<string[]> {
  try {
    const config = await loadWorkspace(root);
    return config.profiles?.[profile] ?? [];
  } catch {
    return [];
  }
}

function setNestedSetting(
  settings: import("../../services/settings.ts").RepotruckSettings,
  key: string,
  value: string | boolean | number,
): import("../../services/settings.ts").RepotruckSettings {
  if (!key.includes(".")) return { ...settings, [key]: value };
  const [head, tail] = key.split(".") as [string, string];
  const current = (settings as Record<string, unknown>)[head];
  const base = typeof current === "object" && current !== null ? current : {};
  return { ...settings, [head]: { ...(base as object), [tail]: value } };
}

function unsetNestedSetting(
  settings: import("../../services/settings.ts").RepotruckSettings,
  key: string,
): import("../../services/settings.ts").RepotruckSettings {
  if (!key.includes(".")) {
    const next = { ...settings } as Record<string, unknown>;
    delete next[key];
    return next as import("../../services/settings.ts").RepotruckSettings;
  }
  const [head, tail] = key.split(".") as [string, string];
  const current = (settings as Record<string, unknown>)[head];
  if (typeof current !== "object" || current === null) return settings;
  const section = { ...(current as Record<string, unknown>) };
  delete section[tail];
  return { ...settings, [head]: section };
}
