import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RepotruckConfig } from "../src/services/config.ts";
import {
  defaultRunCommandImpl,
  type RunCommandImpl,
  type RunCommandOutcome,
  type RunCommandRequest,
  runInRepos,
  selectRunTargets,
} from "../src/services/runner.ts";

const pendingDirs: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "repotruck-runner-"));
  pendingDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of pendingDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* swept by the next run */
    }
  }
});

function makeConfig(root: string, withMissing: boolean): RepotruckConfig {
  const repos: RepotruckConfig["repos"] = [
    {
      owner: "monalisa",
      name: "beta",
      relativePath: "monalisa/source/beta",
      category: "source",
      internal: true,
      language: "TypeScript",
      updatedAt: null,
    },
    {
      owner: "monalisa",
      name: "alpha",
      relativePath: "monalisa/source/alpha",
      category: "source",
      internal: true,
      language: "TypeScript",
      updatedAt: null,
    },
  ];
  if (withMissing) {
    repos.push({
      owner: "ghost",
      name: "missing",
      relativePath: "ghost/source/missing",
      category: "source",
      internal: true,
      language: null,
      updatedAt: null,
    });
  }
  return {
    version: 1,
    root,
    preset: "categorized",
    lastSync: null,
    repos,
  };
}

function makeFixture(withMissing: boolean): { root: string; config: RepotruckConfig } {
  const root = makeTempRoot();
  mkdirSync(path.join(root, "monalisa", "source", "beta"), { recursive: true });
  mkdirSync(path.join(root, "monalisa", "source", "alpha"), { recursive: true });
  return { root, config: makeConfig(root, withMissing) };
}

interface Recorder {
  requests: RunCommandRequest[];
  maxInFlight: number;
}

type OutcomeHandler = (request: RunCommandRequest) => Promise<Partial<RunCommandOutcome>>;

function recordingImpl(recorder: Recorder, handler: OutcomeHandler): RunCommandImpl {
  let inFlight = 0;
  return async (request) => {
    recorder.requests.push(request);
    inFlight += 1;
    recorder.maxInFlight = Math.max(recorder.maxInFlight, inFlight);
    try {
      const outcome = await handler(request);
      return {
        exitCode: outcome.exitCode ?? null,
        stdout: outcome.stdout ?? "",
        stderr: outcome.stderr ?? "",
        message: outcome.message,
      };
    } finally {
      inFlight -= 1;
    }
  };
}

describe("selectRunTargets", () => {
  test("empty refs select every tracked repository", () => {
    const { config } = makeFixture(true);
    const { entries, skipped } = selectRunTargets(config, []);
    expect(entries.length).toBe(3);
    expect(skipped).toEqual([]);
  });

  test("refs resolve by owner/name and by relative path", () => {
    const { config } = makeFixture(false);
    const { entries, skipped } = selectRunTargets(config, [
      "monalisa/alpha",
      "monalisa/source/beta",
      "nope/nothing",
    ]);
    expect(entries.map((entry) => entry.name)).toEqual(["alpha", "beta"]);
    expect(skipped).toEqual([
      { key: "nope/nothing", message: "not tracked by repotruck: nope/nothing" },
    ]);
  });
});

describe("runInRepos", () => {
  test("runs the command in every selected repo and orders results by path", async () => {
    const { root, config } = makeFixture(true);
    const recorder: Recorder = { requests: [], maxInFlight: 0 };
    const result = await runInRepos({
      root,
      config,
      refs: [],
      command: "bun",
      args: ["test"],
      runImpl: recordingImpl(recorder, async () => ({ exitCode: 0, stdout: "ok" })),
    });
    expect(result.results.map((row) => row.key)).toEqual(["monalisa/alpha", "monalisa/beta"]);
    expect(result.results.every((row) => row.ok)).toBe(true);
    expect(result.results.every((row) => row.stdout === "ok")).toBe(true);
    expect(result.skipped).toEqual([
      { key: "ghost/missing", message: "ghost/source/missing is not on disk" },
    ]);
    const cwds = recorder.requests.map((request) => request.cwd);
    expect(cwds).toContain(path.join(root, "monalisa", "source", "alpha"));
    expect(cwds).toContain(path.join(root, "monalisa", "source", "beta"));
    expect(
      recorder.requests.every((request) => request.command === "bun" && request.args[0] === "test"),
    ).toBe(true);
  });

  test("limits concurrency to the requested value", async () => {
    const { root, config } = makeFixture(false);
    const recorder: Recorder = { requests: [], maxInFlight: 0 };
    const result = await runInRepos({
      root,
      config,
      refs: [],
      command: "sleep",
      concurrency: 1,
      runImpl: recordingImpl(recorder, async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { exitCode: 0 };
      }),
    });
    expect(result.results.length).toBe(2);
    expect(recorder.maxInFlight).toBe(1);
  });

  test("reports non-zero exit codes as failures with stderr", async () => {
    const { root, config } = makeFixture(false);
    const result = await runInRepos({
      root,
      config,
      refs: [],
      command: "bun",
      runImpl: (async (request: RunCommandRequest): Promise<RunCommandOutcome> =>
        request.cwd.endsWith("alpha")
          ? { exitCode: 0, stdout: "pass", stderr: "" }
          : { exitCode: 1, stdout: "", stderr: "1 test failed" }) as RunCommandImpl,
    });
    const alpha = result.results.find((row) => row.key === "monalisa/alpha")!;
    const beta = result.results.find((row) => row.key === "monalisa/beta")!;
    expect(alpha.ok).toBe(true);
    expect(beta.ok).toBe(false);
    expect(beta.exitCode).toBe(1);
    expect(beta.stderr).toBe("1 test failed");
    expect(beta.message).toBeUndefined();
  });

  test("turns spawn errors into single-line failure messages", async () => {
    const { root, config } = makeFixture(false);
    const result = await runInRepos({
      root,
      config,
      refs: ["monalisa/alpha"],
      command: "definitely-missing-command",
      runImpl: (async (): Promise<RunCommandOutcome> => {
        throw new Error("spawn definitely-missing-command ENOENT\nextra line");
      }) as RunCommandImpl,
    });
    expect(result.results.length).toBe(1);
    const row = result.results[0]!;
    expect(row.ok).toBe(false);
    expect(row.exitCode).toBeNull();
    expect(row.message).toBe("spawn definitely-missing-command ENOENT");
    expect(row.message!.includes("\n")).toBe(false);
  });

  test("narrows to explicit refs and skips unknown ones", async () => {
    const { root, config } = makeFixture(false);
    const recorder: Recorder = { requests: [], maxInFlight: 0 };
    const result = await runInRepos({
      root,
      config,
      refs: ["monalisa/beta", "unknown/ref"],
      command: "pwd",
      runImpl: recordingImpl(recorder, async () => ({ exitCode: 0 })),
    });
    expect(recorder.requests.length).toBe(1);
    expect(result.results.map((row) => row.key)).toEqual(["monalisa/beta"]);
    expect(result.skipped).toEqual([
      { key: "unknown/ref", message: "not tracked by repotruck: unknown/ref" },
    ]);
  });

  test("missing directories are skippable through the exists seam", async () => {
    const { root, config } = makeFixture(false);
    const result = await runInRepos({
      root,
      config,
      refs: [],
      command: "pwd",
      exists: () => false,
      runImpl: (async (): Promise<RunCommandOutcome> => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
      })) as RunCommandImpl,
    });
    expect(result.results).toEqual([]);
    expect(result.skipped.map((row) => row.key)).toEqual(["monalisa/alpha", "monalisa/beta"]);
  });
});

describe("defaultRunCommandImpl", () => {
  test("captures exit code and output from a real child process", async () => {
    const root = makeTempRoot();
    const outcome = await defaultRunCommandImpl({
      command: process.execPath,
      args: ["-e", "console.log('hello'); process.exit(0)"],
      cwd: root,
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain("hello");
  });

  test("reports a non-zero exit code verbatim", async () => {
    const root = makeTempRoot();
    const outcome = await defaultRunCommandImpl({
      command: process.execPath,
      args: ["-e", "console.error('boom'); process.exit(3)"],
      cwd: root,
    });
    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr).toContain("boom");
  });
});
