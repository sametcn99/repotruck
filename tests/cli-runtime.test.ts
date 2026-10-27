import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "src", "cli.ts");

function runCli(args: string[], env?: Record<string, string>) {
  const mergedEnv: Record<string, string | undefined> = { ...process.env, ...env };
  if (env) {
    for (const key of Object.keys(env)) {
      for (const existingKey of Object.keys(mergedEnv)) {
        if (existingKey.toLowerCase() === key.toLowerCase() && existingKey !== key) {
          delete mergedEnv[existingKey];
        }
      }
    }
  }
  return Bun.spawnSync([process.execPath, "run", cliPath, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: mergedEnv as Record<string, string>,
  });
}

const tempRoots: string[] = [];

function tempDir(prefix: string): string {
  const dir = (realpathSync.native ?? realpathSync)(mkdtempSync(path.join(tmpdir(), prefix)));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("CLI help surface", () => {
  test("root --help lists every subcommand in English", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    const commands = [
      "clone",
      "create",
      "sync",
      "reorganize",
      "move",
      "forget",
      "prune",
      "delete",
      "archive",
      "status",
      "workspaces",
      "root",
      "config",
      "update",
      "open",
      "alias",
      "mcp",
      "auth",
      "doctor",
      "stats",
      "completions",
      "search-code",
      "run",
      "instructions",
    ];
    expect(commands.length).toBe(24);
    for (const command of commands) {
      expect(text).toContain(command);
    }
  });

  test("lifecycle --help documents the contract flags", () => {
    for (const [command, flags] of [
      ["forget", ["<repo>", "-d, --dir"]],
      ["prune", ["--dry-run", "-d, --dir"]],
      ["delete", ["<repo>", "--yes", "-d, --dir"]],
      ["archive", ["<repo>", "-d, --dir"]],
      ["status", ["-d, --dir"]],
    ] as const) {
      const result = runCli([command, "--help"]);
      expect(result.exitCode).toBe(0);
      const text = result.stdout!.toString();
      for (const flag of flags) {
        expect(text).toContain(flag);
      }
    }
  });

  test("clone --help documents -d and -p", () => {
    const result = runCli(["clone", "--help"]);
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    expect(text).toContain("-d, --dir");
    expect(text).toContain("-p, --preset");
    expect(text).toContain("<url>");
  });

  test("create --help documents every flag", () => {
    const result = runCli(["create", "--help"]);
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    for (const flag of [
      "--from",
      "--at",
      "--public",
      "--private",
      "--description",
      "--org",
      "-d, --dir",
    ]) {
      expect(text).toContain(flag);
    }
    expect(text).toContain("private");
  });

  test("sync --help documents --limit and --scope semantics", () => {
    const result = runCli(["sync", "--help"]);
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString().replace(/\s+/g, " ");
    expect(text).toContain("-s, --scope");
    expect(text).toContain("-l, --limit");
    expect(text).toContain("org:<name>");
    expect(text).toContain("API order");
    expect(text).toContain("active organization");
  });

  test("reorganize --help documents scan, dry-run, keep-custom", () => {
    const result = runCli(["reorganize", "--help"]);
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    for (const flag of ["--scan", "--dry-run", "--keep-custom", "-d, --dir"]) {
      expect(text).toContain(flag);
    }
    expect(text).toContain("<preset>");
  });

  test("move --help documents arguments", () => {
    const result = runCli(["move", "--help"]);
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    expect(text).toContain("<owner/name>");
    expect(text).toContain("<relative-path>");
    expect(text).toContain("-d, --dir");
  });

  test("workspaces --help documents list and remove", () => {
    const result = runCli(["workspaces", "--help"]);
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    expect(text).toContain("list");
    expect(text).toContain("remove");
  });
});

describe("CLI errors", () => {
  test("move outside a workspace fails with the contract message", () => {
    const empty = tempDir("repotruck-cli-empty-");
    const configDir = tempDir("repotruck-cli-cfg-empty-");
    const result = runCli(["move", "acme/api", "acme/moved", "-d", empty], {
      REPOTRUCK_CONFIG_DIR: configDir,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr!.toString()).toContain("not a repotruck workspace");
    expect(result.stderr!.toString()).toContain("no record for it in the central repotruck.json");
  });

  test("reorganize outside a workspace fails with the contract message", () => {
    const empty = tempDir("repotruck-cli-empty2-");
    const configDir = tempDir("repotruck-cli-cfg-empty2-");
    const result = runCli(["reorganize", "categorized", "-d", empty], {
      REPOTRUCK_CONFIG_DIR: configDir,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr!.toString()).toContain("not a repotruck workspace");
  });

  test("invalid preset fails in English", () => {
    const root = tempDir("repotruck-cli-badpreset-");
    mkdirSync(root, { recursive: true });
    const result = runCli(["sync", "-d", root, "-p", "bogus", "--limit", "1"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr!.toString()).toContain("invalid preset: bogus");
  });

  test("invalid scope fails before any GitHub call", () => {
    const root = tempDir("repotruck-cli-badscope-");
    const result = runCli(["sync", "-d", root, "--scope", "bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr!.toString()).toContain("invalid scope: bogus");
  });

  test("invalid limit fails in English", () => {
    const root = tempDir("repotruck-cli-badlimit-");
    const result = runCli(["sync", "-d", root, "--limit", "zero"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr!.toString()).toContain("invalid limit: zero");
  });

  test("missing clone argument fails with commander usage", () => {
    const result = runCli(["clone"]);
    expect(result.exitCode).toBe(1);
    const output = `${result.stderr!.toString()}${result.stdout!.toString()}`;
    expect(output).toContain("missing required argument");
  });

  test("unknown workspaces action fails in English", () => {
    const result = runCli(["workspaces", "destroy"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr!.toString()).toContain("unknown action: destroy");
  });

  test("workspaces remove without a path fails in English", () => {
    const result = runCli(["workspaces", "remove"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr!.toString()).toContain("requires a path");
  });

  test("workspaces remove reports the removed workspace and the records file", () => {
    const configDir = tempDir("repotruck-cli-cfg-rm-");
    const ws = tempDir("repotruck-cli-ws-rm-");
    writeFileSync(
      path.join(configDir, "repotruck.json"),
      JSON.stringify({
        version: 1,
        workspaces: [
          {
            version: 1,
            root: ws,
            preset: "categorized",
            lastSync: null,
            lastUsed: "2026-10-23T00:00:00.000Z",
            repos: [],
          },
        ],
      }),
      "utf8",
    );
    const result = runCli(["workspaces", "remove", ws], { REPOTRUCK_CONFIG_DIR: configDir });
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    expect(text).toContain(`removed workspace: ${ws}`);
    expect(text).toContain(`records: ${path.join(configDir, "repotruck.json")}`);
  });

  test("workspaces remove of an unknown path names the records file", () => {
    const configDir = tempDir("repotruck-cli-cfg-rm2-");
    const result = runCli(["workspaces", "remove", "C:\\definitely\\not\\registered"], {
      REPOTRUCK_CONFIG_DIR: configDir,
    });
    expect(result.exitCode).toBe(1);
    const text = result.stderr!.toString();
    expect(text).toContain("workspace not found");
    expect(text).toContain(`records: ${path.join(configDir, "repotruck.json")}`);
  });
});

describe("CLI root action guards", () => {
  test("bare command in a non-TTY context fails with the TTY message", () => {
    const result = runCli([]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr!.toString()).toContain("TTY");
  });

  test("workspaces list works against an isolated config dir", () => {
    const configDir = tempDir("repotruck-cli-cfg-");
    const result = runCli(["workspaces", "list"], { REPOTRUCK_CONFIG_DIR: configDir });
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    expect(text).toContain("no registered workspaces");
    expect(text).toContain(`workspace records: ${path.join(configDir, "repotruck.json")}`);
  });
});

describe("CLI corrupt central store", () => {
  test("workspaces list fails with a single-line error naming the .bak backup", () => {
    const configDir = tempDir("repotruck-cli-corrupt-");
    const storePath = path.join(configDir, "repotruck.json");
    writeFileSync(storePath, "{ corrupt json ]", "utf8");
    const result = runCli(["workspaces", "list"], { REPOTRUCK_CONFIG_DIR: configDir });
    expect(result.exitCode).toBe(1);
    const text = result.stderr!.toString();
    expect(text).toContain("repotruck.json is corrupt");
    expect(text).toContain(`${storePath}.bak`);
    expect(text.trim().split("\n").length).toBe(1);
    expect(existsSync(`${storePath}.bak`)).toBe(true);
  });

  test("workspaces remove against a corrupt store fails without touching the store bytes", () => {
    const configDir = tempDir("repotruck-cli-corrupt-rm-");
    const storePath = path.join(configDir, "repotruck.json");
    const corruptBytes = "{ corrupt json ]";
    writeFileSync(storePath, corruptBytes, "utf8");
    const result = runCli(["workspaces", "remove", "C:\\definitely\\not\\registered"], {
      REPOTRUCK_CONFIG_DIR: configDir,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr!.toString()).toContain("repotruck.json is corrupt");
    expect(readFileSync(storePath, "utf8")).toBe(corruptBytes);
  });
});

describe("CLI create flag conflicts", () => {
  test("create rejects --private together with --public before any network call", () => {
    const configDir = tempDir("repotruck-cli-flagconflict-");
    const result = runCli(["create", "demo", "--private", "--public"], {
      REPOTRUCK_CONFIG_DIR: configDir,
    });
    expect(result.exitCode).toBe(1);
    const text = result.stderr!.toString();
    expect(text).toContain("--private");
    expect(text).toContain("--public");
    expect(text.trim().split("\n").length).toBe(1);
  });
});

describe("CLI sync flag validation", () => {
  test("invalid concurrency is rejected before any auth or network", () => {
    const configDir = tempDir("repotruck-cli-conc-");
    const result = runCli(["sync", "-c", "0"], { REPOTRUCK_CONFIG_DIR: configDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr!.toString()).toContain("invalid concurrency: 0");
  });

  test("invalid depth is rejected", () => {
    const configDir = tempDir("repotruck-cli-depth-");
    const result = runCli(["sync", "--depth", "abc"], { REPOTRUCK_CONFIG_DIR: configDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr!.toString()).toContain("invalid depth: abc");
  });

  test("invalid divergence strategy is rejected", () => {
    const configDir = tempDir("repotruck-cli-div-");
    const result = runCli(["sync", "--divergence", "bogus"], {
      REPOTRUCK_CONFIG_DIR: configDir,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr!.toString()).toContain(
      "invalid divergence: bogus (expected fail, rebase, reset, or skip)",
    );
  });
});

describe("CLI lifecycle commands", () => {
  function registeredWorkspace(
    prefix: string,
    repoRel = "acme/source/api",
  ): {
    root: string;
    configDir: string;
  } {
    const root = tempDir(`${prefix}-root-`);
    mkdirSync(path.join(root, ...repoRel.split("/")), { recursive: true });
    const configDir = tempDir(`${prefix}-cfg-`);
    writeFileSync(
      path.join(configDir, "repotruck.json"),
      JSON.stringify({
        version: 1,
        workspaces: [
          {
            version: 1,
            root,
            preset: "categorized",
            lastSync: "2026-10-24T00:00:00.000Z",
            lastUsed: "2026-10-24T00:00:00.000Z",
            repos: [
              {
                owner: "acme",
                name: "api",
                relativePath: repoRel,
                category: "source",
                internal: true,
                language: null,
                updatedAt: null,
              },
            ],
            aliases: {},
          },
        ],
      }),
      "utf8",
    );
    return { root, configDir };
  }

  test("forget untracks without touching the disk", () => {
    const { root, configDir } = registeredWorkspace("rt-cli-fgt");
    const env = { REPOTRUCK_CONFIG_DIR: configDir };
    const result = runCli(["forget", "acme/api", "-d", root], env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout!.toString()).toContain("kept on disk at acme/source/api");
    expect(existsSync(path.join(root, "acme", "source", "api"))).toBe(true);
    const status = runCli(["status", "-d", root], env);
    expect(status.exitCode).toBe(0);
    expect(status.stdout!.toString()).toContain("no repositories tracked");
  });

  test("delete refuses without --yes and removes with it", () => {
    const { root, configDir } = registeredWorkspace("rt-cli-del");
    const env = { REPOTRUCK_CONFIG_DIR: configDir };
    const refused = runCli(["delete", "acme/api", "-d", root], env);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr!.toString()).toContain("delete requires --yes");
    expect(existsSync(path.join(root, "acme", "source", "api"))).toBe(true);
    const deleted = runCli(["delete", "acme/api", "--yes", "-d", root], env);
    expect(deleted.exitCode).toBe(0);
    expect(deleted.stdout!.toString()).toContain("removed acme/source/api");
    expect(existsSync(path.join(root, "acme", "source", "api"))).toBe(false);
  });

  test("status prints the last-sync header and per-repository lines", () => {
    const { root, configDir } = registeredWorkspace("rt-cli-st");
    const result = runCli(["status", "-d", root], { REPOTRUCK_CONFIG_DIR: configDir });
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    expect(text).toContain("last sync (workspace): 2026-10-24T00:00:00.000Z");
    expect(text).toContain("acme/api — ");
    expect(text).toContain("category source");
  });

  test("prune and archive require authentication before any GitHub call", () => {
    const { root, configDir } = registeredWorkspace("rt-cli-auth");
    const env = {
      REPOTRUCK_CONFIG_DIR: configDir,
      PATH: configDir,
      REPOTRUCK_TOKEN: "",
      REPOTRUCK_OAUTH_CLIENT_ID: "",
    };
    for (const command of [
      ["prune", "-d", root],
      ["archive", "acme/api", "-d", root],
    ]) {
      const result = runCli(command, env);
      expect(result.exitCode).toBe(1);
      const stderr = result.stderr!.toString();
      expect(stderr).toContain("authentication");
      expect(stderr.split("\n").filter((line) => line.length > 0).length).toBe(1);
      expect(existsSync(path.join(root, "acme", "source", "api"))).toBe(true);
    }
  });
});

describe("CLI config command", () => {
  test("config set/get/list round-trips a sync setting", () => {
    const configDir = tempDir("repotruck-cli-cfgcmd-");
    const env = { REPOTRUCK_CONFIG_DIR: configDir };
    const set = runCli(["config", "set", "sync.concurrency", "7"], env);
    expect(set.exitCode).toBe(0);
    expect(set.stdout!.toString()).toContain("sync.concurrency set");
    const get = runCli(["config", "get", "sync.concurrency"], env);
    expect(get.exitCode).toBe(0);
    const text = get.stdout!.toString();
    expect(text).toContain("sync.concurrency: 7");
    expect(text).toContain("(settings)");
    const list = runCli(["config", "list"], env);
    expect(list.exitCode).toBe(0);
    expect(list.stdout!.toString()).toContain("sync.divergence: fail");
  });

  test("unknown keys and invalid values fail in English on one line", () => {
    const configDir = tempDir("repotruck-cli-cfgcmd2-");
    const env = { REPOTRUCK_CONFIG_DIR: configDir };
    const unknown = runCli(["config", "set", "sync.bogus", "1"], env);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr!.toString()).toContain("unknown config key: sync.bogus");
    const badValue = runCli(["config", "set", "sync.divergence", "bogus"], env);
    expect(badValue.exitCode).toBe(1);
    expect(badValue.stderr!.toString()).toContain("invalid value for sync.divergence: bogus");
    const badBool = runCli(["config", "set", "sync.blobless", "yes"], env);
    expect(badBool.exitCode).toBe(1);
    expect(badBool.stderr!.toString()).toContain("expected true or false");
  });

  test("unset keys read back their defaults", () => {
    const configDir = tempDir("repotruck-cli-cfgcmd3-");
    const result = runCli(["config", "get", "sync.concurrency"], {
      REPOTRUCK_CONFIG_DIR: configDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout!.toString()).toContain("sync.concurrency: 3 (default)");
  });
});

describe("CLI auth command (AU1 / T1'')", () => {
  test("auth login short-circuits with env message when REPOTRUCK_TOKEN is set", () => {
    const configDir = tempDir("repotruck-cli-auth-login-");
    const env = {
      REPOTRUCK_CONFIG_DIR: configDir,
      REPOTRUCK_TOKEN: "mock-env-token",
    };
    const result = runCli(["auth", "login"], env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout!.toString()).toContain(
      "already logged in (method: env) - unset REPOTRUCK_TOKEN to use the device flow",
    );
  });

  test("auth status outputs method without token leak", () => {
    const configDir = tempDir("repotruck-cli-auth-status-");
    const env = {
      REPOTRUCK_CONFIG_DIR: configDir,
      REPOTRUCK_TOKEN: "mock-secret-token",
    };
    const result = runCli(["auth", "status"], env);
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    expect(text).toContain("method: env");
    expect(text).not.toContain("mock-secret-token");
  });
});

describe("CLI completions command (CO1-CO4, T3'')", () => {
  test("generates bash completions with tail comment", () => {
    const result = runCli(["completions", "bash"]);
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    expect(text).toContain("complete -F _repotruck repotruck");
    expect(text.trimEnd().endsWith("# source this in ~/.bashrc")).toBe(true);
  });

  test("generates zsh completions with tail comment", () => {
    const result = runCli(["completions", "zsh"]);
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    expect(text).toContain("#compdef repotruck");
    expect(text.trimEnd().endsWith("# source this in ~/.zshrc (or drop into a fpath dir)")).toBe(
      true,
    );
  });

  test("generates fish completions with tail comment", () => {
    const result = runCli(["completions", "fish"]);
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    expect(text).toContain("complete -c repotruck");
    expect(text.trimEnd().endsWith("# save as ~/.config/fish/completions/repotruck.fish")).toBe(
      true,
    );
  });
});

describe("CLI instructions template command", () => {
  test("instructions template lists available templates", () => {
    const result = runCli(["instructions", "template"]);
    expect(result.exitCode).toBe(0);
    const text = result.stdout!.toString();
    expect(text).toContain("node - ");
    expect(text).toContain("python - ");
    expect(text).toContain("monorepo - ");
  });
});

describe("CLI JSON envelope errors", () => {
  test("status --json on invalid workspace returns JSON error payload", () => {
    const emptyDir = tempDir("repotruck-cli-json-err-");
    const result = runCli(["status", "-d", emptyDir, "--json"]);
    expect(result.exitCode).toBe(1);
    const text = (result.stdout!.toString() || result.stderr!.toString()).trim();
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(false);
    expect(parsed.command).toBe("status");
    expect(typeof parsed.error).toBe("string");
  });
});
