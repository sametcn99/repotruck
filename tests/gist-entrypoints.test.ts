import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildCliProgram } from "../src/cli/index.ts";
import type { CliContext } from "../src/cli/shared.ts";
import { createRepotruckMcpServer } from "../src/mcp/server.ts";
import { gistPath } from "../src/services/gistGit.ts";
import { gistApiFixture, PUBLIC_ID, SECRET_ID } from "./helpers/gists.ts";
import { workspaceFixture } from "./helpers/hardening.ts";

async function cli(args: string[], overrides: Partial<CliContext>) {
  const original = process.stdout.write;
  const exitCode = process.exitCode;
  let stdout = "";
  process.stdout.write = ((chunk: string) => {
    stdout += chunk;
    return true;
  }) as typeof original;
  try {
    process.exitCode = 0;
    const program = await buildCliProgram(overrides);
    await program.parseAsync(args, { from: "user" });
    return { stdout, exitCode: process.exitCode, payload: JSON.parse(stdout) };
  } finally {
    process.stdout.write = original;
    process.exitCode = exitCode ?? 0;
  }
}

test("headless sync includes Gists for an empty repo selection, redacts details, and respects bounds", async () => {
  const fixture = workspaceFixture();
  const previous = process.env.REPOTRUCK_CONFIG_DIR;
  process.env.REPOTRUCK_CONFIG_DIR = fixture.configDir;
  try {
    const { github, requests } = gistApiFixture();
    // Force one per-ID checkout error without dialing a live Git transport.
    for (const id of [PUBLIC_ID, SECRET_ID])
      mkdirSync(gistPath(fixture.root, id), { recursive: true });
    const auth = { token: "fixture-token", method: "env" as const };
    const ctx = { buildGithub: () => github, requireAuth: async () => auth };
    const flags = ["--dir", fixture.root, "--json"];
    const result = await cli(["sync", ...flags], ctx);
    expect(result.exitCode).toBe(1);
    expect(result.payload.synced).toEqual([]);
    expect(result.payload.gists).toEqual({
      synced: 0,
      ahead: 0,
      failed: 2,
      errors: { checkout: 2 },
    });
    expect(result.stdout).not.toContain(SECRET_ID);
    expect(result.stdout).not.toContain("Secret notes");

    for (const selector of [
      ["--no-gists"],
      ["--scope", "org:acme"],
      ["--limit", "1"],
      ["--include", "acme/*"],
      ["--pinned"],
    ]) {
      requests.length = 0;
      const excluded = await cli(["sync", ...flags, ...selector], ctx);
      expect(excluded.exitCode).toBe(0);
      expect(excluded.payload.gists).toBeUndefined();
      expect(requests.some(({ route }) => route === "/gists")).toBe(false);
    }

    const listed = await cli(["gist", "list", ...flags], ctx);
    expect(listed.payload.result.map(({ id }: { id: string }) => id)).toEqual([
      PUBLIC_ID,
      SECRET_ID,
    ]);
    const show = await cli(["gist", "show", SECRET_ID, "--file", "notes.txt", ...flags], ctx);
    expect(show.payload.result.content).toBe("first line\nsecond line\n");
    const createdFile = path.join(fixture.base, "new.md");
    writeFileSync(createdFile, "local text\n");
    const edited = await cli(["gist", "edit", SECRET_ID, "--file", createdFile, ...flags], ctx);
    expect(edited.payload.result.gist.files).toContain("new.md");
    const stale = await cli(
      [
        "gist",
        "edit",
        SECRET_ID,
        "--description",
        "updated",
        "--expect-version",
        "stale",
        ...flags,
      ],
      ctx,
    );
    expect(stale.payload.error).toContain("changed on GitHub");
    const denied = await cli(["gist", "delete", SECRET_ID, ...flags], ctx);
    expect(denied.payload.error).toContain("--yes");
    expect((await cli(["gist", "delete", SECRET_ID, "--yes", ...flags], ctx)).payload.ok).toBe(
      true,
    );
  } finally {
    if (previous === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
    else process.env.REPOTRUCK_CONFIG_DIR = previous;
    fixture.cleanup();
  }
});

test("MCP sync respects scope and opt-out, performs direct Gist operations, and keeps general resources private", async () => {
  const fixture = workspaceFixture();
  const { github, requests } = gistApiFixture();
  fixture.config.gists = [{ id: SECRET_ID }];
  await fixture.save();
  for (const id of [PUBLIC_ID, SECRET_ID])
    mkdirSync(gistPath(fixture.root, id), { recursive: true });
  const server = await createRepotruckMcpServer({
    env: fixture.env,
    cwd: fixture.root,
    toolContextOverrides: {
      resolveRoot: async () => fixture.root,
      requireAuth: async () => ({ github, token: "fixture-token" }),
    },
  });
  const client = new Client({ name: "gist-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    async function call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as { text: string }[])[0]!.text;
      return { ...result, text };
    }
    const result = await call("repotruck_sync", { preset: "flat-by-owner" });
    expect(JSON.parse(result.text).preset).toBe("flat-by-owner");
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.text).gists).toEqual({
      synced: 0,
      ahead: 0,
      failed: 2,
      errors: { checkout: 2 },
    });
    expect(result.text).not.toContain(SECRET_ID);

    for (const args of [
      { includeGists: false },
      { scope: "org", org: "acme" },
      { limit: 1 },
      { exclude: ["*"] },
    ]) {
      requests.length = 0;
      const scoped = await call("repotruck_sync", args);
      expect(JSON.parse(scoped.text).gists).toBeUndefined();
      expect(requests.some(({ route }) => route === "/gists")).toBe(false);
    }
    const offline = await call("repotruck_gist_list", { trackedOnly: true });
    expect(JSON.parse(offline.text)).toEqual([
      { id: SECRET_ID, gist: null, tracked: true, local: "invalid" },
    ]);
    const shown = await call("repotruck_gist_show", { ref: SECRET_ID });
    const { version } = JSON.parse(shown.text);
    expect(
      (
        await call("repotruck_gist_edit", {
          ref: SECRET_ID,
          expectedVersion: version,
          description: "New text",
        })
      ).text,
    ).toContain("New text");
    const missingConfirmation = await call("repotruck_gist_delete", { ref: SECRET_ID });
    expect(missingConfirmation.isError).toBe(true);

    for (const uri of ["repotruck://inventory", "repotruck://agents-md", "repotruck://tree"]) {
      const resource = await client.readResource({ uri });
      expect(JSON.stringify(resource)).not.toContain(SECRET_ID);
    }
    const deletion = await call("repotruck_gist_delete", { ref: SECRET_ID, confirm: "yes" });
    expect(JSON.parse(deletion.text).id).toBe(SECRET_ID);
  } finally {
    await Promise.all([client.close(), server.close()]);
    fixture.cleanup();
  }
});
