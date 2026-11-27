import { deleteWorkspaceProfile, saveWorkspaceProfile } from "../../core/profiles.ts";
import { validateCustomPreset } from "../../presets/index.ts";
import type { GenerateAgentsMdInput } from "../../services/agentsMd.ts";
import { standaloneVersion } from "../../services/distribution.ts";
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
    if (this.state.deviceFlow?.waiting === true || this.state.deviceFlow?.loading === true) return;
    if ((process.env.REPOTRUCK_TOKEN ?? "").length > 0) {
      this.pushStatus(
        "FAILED",
        "[auth]",
        "already logged in (method: env) — unset REPOTRUCK_TOKEN to use the device flow",
      );
      return;
    }
    const operation = this.operations.start("device-flow");
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
      const handle = await this.deps.beginDeviceLoginFn({
        env: process.env,
        signal: operation.signal,
      });
      void handle.completion.catch(() => {});
      if (!operation.current()) return;
      this.set({
        deviceFlow: {
          loading: false,
          verificationUri: handle.verificationUri,
          userCode: handle.userCode,
          waiting: true,
          error: null,
        },
      });
      await handle.completion;
      if (!operation.current()) return;
      this.set({ deviceFlow: null });
      this.closeModal();
      this.pushStatus("DONE", "[auth]", "logged in via device flow");
      await this.init();
    } catch (error) {
      if (!operation.current()) return;
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
    } finally {
      operation.finish();
    }
  };

  cancelDeviceFlow = (): void => {
    this.operations.cancel("device-flow");
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
    const operation = this.workspaceOperation("profileSaveFromSelection");
    const { pushStatus } = operation;
    try {
      try {
        const refs =
          this.state.selected.size > 0
            ? [...this.state.selected]
            : [...this.state.localHealth.entries()].filter(([, h]) => h.pinned).map(([key]) => key);
        const result = await saveWorkspaceProfile(operation.root, name, refs);
        pushStatus(result.ok ? "DONE" : "FAILED", "[profile]", result.message);
        if (result.ok) if (operation.current()) await this.refreshLocalState();
      } catch (error) {
        pushStatus("FAILED", "[profile]", error instanceof Error ? error.message : String(error));
      }
    } finally {
      operation.finish();
    }
  };

  profileDelete = async (name: string): Promise<void> => {
    const operation = this.workspaceOperation("profileDelete");
    const { pushStatus } = operation;
    try {
      try {
        const result = await deleteWorkspaceProfile(operation.root, name);
        pushStatus(result.ok ? "DONE" : "FAILED", "[profile]", result.message);
        if (result.ok) if (operation.current()) await this.refreshLocalState();
      } catch (error) {
        pushStatus("FAILED", "[profile]", error instanceof Error ? error.message : String(error));
      }
    } finally {
      operation.finish();
    }
  };

  // ---- Agents page (t12) ---------------------------------------------------------
  applyAgentsTemplate = async (name: string, clear = false): Promise<void> => {
    const operation = this.workspaceOperation("applyAgentsTemplate");
    const { pushStatus } = operation;
    try {
      try {
        const input = await this.agentsMdInput(operation.root);
        if (!operation.current()) return;
        const templateInput = { ...input, root: operation.root };
        const result = clear
          ? await clearAgentsMdTemplate(templateInput)
          : await applyAgentsMdTemplate(templateInput, name);
        pushStatus(result.ok ? "DONE" : "FAILED", "[instructions]", result.message);
      } catch (error) {
        pushStatus(
          "FAILED",
          "[instructions]",
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      operation.finish();
    }
  };

  exportInstructions = async (
    format: "agents" | "cursor" | "claude" | "copilot",
    outPath?: string,
  ): Promise<void> => {
    const operation = this.workspaceOperation("exportInstructions");
    const { pushStatus } = operation;
    try {
      try {
        const input = await this.agentsMdInput(operation.root);
        if (!operation.current()) return;
        const result = await exportInstructionsFile(operation.root, input, format, outPath);
        pushStatus("DONE", "[instructions]", `exported ${format} -> ${result.targetPath}`);
      } catch (error) {
        pushStatus(
          "FAILED",
          "[instructions]",
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      operation.finish();
    }
  };

  private async agentsMdInput(root = this.rootValue): Promise<GenerateAgentsMdInput> {
    const config = this.localConfig ?? (await loadWorkspace(root));
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
      const entry = standaloneVersion
        ? [process.execPath]
        : [process.execPath, process.argv[1] ?? "repotruck"];
      const child = Bun.spawn([...entry, "mcp", "--http", "--port", String(port)], {
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
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
    const operation = this.operations.start("code-search");
    this.set({ codeSearchPage: { ...form, loading: true } });
    try {
      const config = this.localConfig ?? (await loadWorkspace(operation.root));
      if (!operation.current()) return;
      this.localConfig = config;
      const result = await this.deps.searchCodeFn({
        root: operation.root,
        config,
        pattern,
        ...(form.kind !== "" ? { kind: form.kind } : {}),
        ...(form.lang !== "" ? { lang: form.lang } : {}),
        limit: form.limit,
        offline: form.offline,
        ...(form.mode === "text" ? { text: true } : {}),
        ...(form.mode === "re" ? { regex: true } : {}),
      });
      if (!operation.current()) return;
      const guard = this.state.codeSearchPage;
      if (guard !== null)
        this.set({ codeSearchPage: { ...guard, loading: false, matches: result.matches } });
    } catch (error) {
      if (!operation.current()) return;
      const message = error instanceof Error ? error.message : String(error);
      this.pushStatus("FAILED", "[search-code]", message);
      const guard = this.state.codeSearchPage;
      if (guard !== null) this.set({ codeSearchPage: { ...guard, loading: false, matches: [] } });
    } finally {
      operation.finish();
    }
  };

  rebuildCodeIndex = async (): Promise<void> => {
    const operation = this.workspaceOperation("rebuildCodeIndex");
    const { pushStatus } = operation;
    try {
      try {
        const config = this.localConfig ?? (await loadWorkspace(operation.root));
        if (!operation.current()) return;
        this.localConfig = config;
        await this.deps.searchCodeFn({
          root: operation.root,
          config,
          pattern: "",
          rebuild: true,
          offline: true,
        });
        pushStatus("DONE", "[search-code]", "symbol index rebuilt");
      } catch (error) {
        pushStatus(
          "FAILED",
          "[search-code]",
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      operation.finish();
    }
  };

  // ---- Run Console page (t07) ----------------------------------------------
  updateRunConsole = (partial: Partial<import("./types.ts").RunConsoleState>): void => {
    const current = this.state.runConsole ?? defaultRunConsoleState();
    this.set({ runConsole: { ...current, ...partial } });
  };

  runConsoleStart = async (): Promise<void> => {
    if (this.operations.has("runConsoleStart")) return;
    const operation = this.workspaceOperation("runConsoleStart");
    const { set: update, endTask } = operation;
    try {
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
              ? await profileRefs(operation.root, state.profile)
              : [];
      if (!operation.current()) return;
      update({ runConsole: { ...state, running: true, results: [], skipped: [] } });
      const taskId = "run-console";
      this.beginTask(taskId, "run");
      try {
        const config = this.localConfig ?? (await loadWorkspace(operation.root));
        if (!operation.current()) return;
        this.localConfig = config;
        const result = await this.deps.runInReposFn({
          root: operation.root,
          config,
          refs,
          command,
          args,
          concurrency: state.concurrency,
        });
        const guard = this.state.runConsole;
        if (guard !== null) {
          update({
            runConsole: {
              ...guard,
              running: false,
              results: result.results,
              skipped: result.skipped,
            },
          });
        }
        const failed = result.results.filter((r) => !r.ok).length;
        endTask(taskId, `${result.results.length} repos · ${failed} failed`, failed > 0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        endTask(taskId, message, true);
        const guard = this.state.runConsole;
        if (guard !== null) update({ runConsole: { ...guard, running: false } });
      }
    } finally {
      operation.finish();
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
