import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { gistId } from "../src/services/gistApi.ts";
import { GistGit, gistPath } from "../src/services/gistGit.ts";
import {
  autoGistsEnabled,
  GistService,
  gistSyncSummary,
  syncWorkspaceGists,
} from "../src/services/gists.ts";
import { readWorkspaceConfig } from "../src/services/workspaceRegistry.ts";
import {
  CREATED_ID,
  EXTERNAL_ID,
  gistApiFixture,
  gistPayload,
  PUBLIC_ID,
  SECRET_ID,
} from "./helpers/gists.ts";
import { gitRemoteFixture } from "./helpers/gitRemote.ts";
import { workspaceFixture } from "./helpers/hardening.ts";

describe("GitHub Gist mirror", () => {
  test("normalizes links and IDs and refuses other origins or extra path segments", () => {
    expect(gistId(SECRET_ID.toUpperCase())).toBe(SECRET_ID);
    expect(gistId(`https://gist.github.com/acme/${SECRET_ID}#file-notes`)).toBe(SECRET_ID);
    expect(gistId(`https://gist.github.com/${SECRET_ID}.git`)).toBe(SECRET_ID);
    for (const url of [
      `https://other.test/acme/${SECRET_ID}`,
      `https://gist.github.com/acme/${SECRET_ID}/12345`,
      `https://name@gist.github.com/${SECRET_ID}`,
      "../../config",
    ])
      expect(() => gistId(url)).toThrow("Expected a GitHub Gist ID");
  });

  test("paginates, filters by account, and reports truncated file contents", async () => {
    const initial = Array.from({ length: 100 }, (_, index) =>
      gistPayload((index + 1).toString(16), { public: index % 2 === 0 }),
    );
    const extra = gistPayload(SECRET_ID);
    extra.files["notes.txt"]!.truncated = true;
    const { github, requests } = gistApiFixture([
      ...initial,
      extra,
      gistPayload(EXTERNAL_ID, { owner: "someone" }),
    ]);
    const api = github.gists!;
    expect((await api.list("ACME")).map((gist) => gist.id)).toHaveLength(101);
    expect(
      requests.filter((request) => request.route === "/gists").map((request) => request.page),
    ).toEqual(["1", "2"]);
    expect(await api.get(SECRET_ID)).toMatchObject({
      public: false,
      files: ["notes.txt"],
      contents: { "notes.txt": null },
    });
    await expect(api.get(CREATED_ID)).rejects.toThrow("Gist unavailable");
    expect(
      new (github.constructor as typeof import("../src/services/github.ts").GitHubService)("t", {
        baseUrl: "https://enterprise.example.test/api/v3",
      }).gists,
    ).toBeUndefined();
  });

  test("clones public and secret Gists, skips unrelated paths, and keeps metadata out of the workspace map", async () => {
    const fixture = workspaceFixture();
    try {
      await fixture.save();
      const remote = await gitRemoteFixture(fixture);
      const { github } = gistApiFixture([
        gistPayload(PUBLIC_ID, { public: true }),
        gistPayload(SECRET_ID),
        gistPayload(CREATED_ID),
        gistPayload(EXTERNAL_ID, { owner: "someone" }),
      ]);
      const git = new GistGit(fixture.root, undefined, () => remote.url);
      const occupied = gistPath(fixture.root, CREATED_ID);
      mkdirSync(occupied, { recursive: true });
      writeFileSync(path.join(occupied, "sentinel"), "keep me");
      const options = { ...fixture, github, git };
      const summary = await syncWorkspaceGists(options);
      expect(summary).toEqual({ synced: 2, ahead: 0, failed: 1, errors: { checkout: 1 } });
      expect(gistSyncSummary(summary!)).toBe("Gists: 2 synced, 0 ahead, 1 failed (checkout: 1)");
      expect(readFileSync(path.join(occupied, "sentinel"), "utf8")).toBe("keep me");
      expect(readFileSync(path.join(fixture.root, "AGENTS.md"), "utf8")).not.toContain(SECRET_ID);
      expect((await readWorkspaceConfig(fixture.root, fixture.env))?.gists).toEqual([
        { id: PUBLIC_ID },
        { id: SECRET_ID },
      ]);
      const service = new GistService(options);
      expect(await service.sync([EXTERNAL_ID])).toEqual([{ id: EXTERNAL_ID, action: "cloned" }]);
      expect(await service.sync([PUBLIC_ID, PUBLIC_ID])).toEqual([
        { id: PUBLIC_ID, action: "current" },
      ]);
      expect(await service.sync([CREATED_ID, "ffff"])).toMatchObject([
        { id: CREATED_ID, stage: "checkout" },
        { id: "ffff", stage: "lookup" },
      ]);
      expect((await service.list()).find(({ id }) => id === EXTERNAL_ID)?.gist).toEqual(
        expect.objectContaining({
          owner: "someone",
          description: "Secret notes",
        }),
      );
      expect((await service.list(true)).every((row) => row.gist === null)).toBe(true);
      expect((await service.sync()).find(({ id }) => id === EXTERNAL_ID)?.action).toBe("current");
    } finally {
      fixture.cleanup();
    }
  }, 15000);

  test("fast-forwards, pushes committed changes, and preserves dirty or divergent data", async () => {
    const fixture = workspaceFixture();
    try {
      const remote = await gitRemoteFixture(fixture);
      const { github } = gistApiFixture();
      const git = new GistGit(fixture.root, undefined, () => remote.url);
      const service = new GistService({ ...fixture, github, git });
      expect(await service.sync([PUBLIC_ID])).toEqual([{ id: PUBLIC_ID, action: "cloned" }]);
      const directory = await service.localPath(PUBLIC_ID);
      const file = path.join(directory, "same.txt");
      const local = simpleGit({ baseDir: directory, allowConfig: ["commit.gpgsign"] });
      await local.addConfig("user.name", "Fixture");
      await local.addConfig("user.email", "fixture@repotruck.test");
      await local.addConfig("commit.gpgsign", "false");
      await remote.commit("same.txt", "remote\n");
      expect(await git.sync(PUBLIC_ID)).toBe("updated");
      expect(readFileSync(file, "utf8")).toBe("remote\n");
      writeFileSync(file, "dirty\n");
      await expect(git.sync(PUBLIC_ID)).rejects.toThrow("Dirty Gist checkout");
      expect(await git.status(PUBLIC_ID)).toBe("dirty");
      await local.add("same.txt");
      await local.commit("local update");
      expect(await git.sync(PUBLIC_ID)).toBe("ahead");
      expect(await service.push(PUBLIC_ID)).toEqual({ id: PUBLIC_ID, action: "pushed" });
      expect((await remote.bare.raw(["show", "HEAD:same.txt"])).trim()).toBe("dirty");
      expect(await git.push(PUBLIC_ID)).toBe("current");
      await remote.source.pull("--ff-only");
      await remote.commit("same.txt", "next remote\n");
      writeFileSync(file, "next local\n");
      await local.add("same.txt");
      await local.commit("local divergence");
      await expect(git.sync(PUBLIC_ID)).rejects.toThrow("Gist history diverged");
      await expect(git.push(PUBLIC_ID)).rejects.toThrow("Gist upstream has new commits");
      expect(readFileSync(file, "utf8")).toBe("next local\n");
      await local.remote(["set-url", "origin", "https://example.test/repo.git"]);
      await expect(git.sync(PUBLIC_ID)).rejects.toThrow("Gist origin does not match");
      await expect(service.localPath(PUBLIC_ID)).rejects.toThrow("different origin");
    } finally {
      fixture.cleanup();
    }
  }, 15000);

  test("validates patches and stale revisions, creates multi-file Gists, and preserves clones after delete", async () => {
    const fixture = workspaceFixture();
    try {
      const remote = await gitRemoteFixture(fixture);
      const { github, requests, items } = gistApiFixture([
        gistPayload(SECRET_ID),
        gistPayload(EXTERNAL_ID, { owner: "someone" }),
      ]);
      const git = new GistGit(fixture.root, undefined, () => remote.url);
      const service = new GistService({ ...fixture, github, git });
      const files = [
        { name: "alpha.txt", content: "aa" },
        { name: "beta.txt", content: "bb" },
      ];
      await expect(service.create({ files: [{ name: "../bad", content: "bad" }] })).rejects.toThrow(
        "portable Gist filename",
      );
      await expect(service.create({ files: [] })).rejects.toThrow("At least one Gist file");
      await expect(service.create({ files: [{ name: "bad.txt", content: "\0" }] })).rejects.toThrow(
        "UTF-8",
      );
      await expect(
        service.create({ files: [...files, { name: "ALPHA.TXT", content: "cc" }] }),
      ).rejects.toThrow("Duplicate");
      const created = await service.create({ files, description: "Multi-file" });
      expect(created).toMatchObject({
        gist: { id: CREATED_ID, public: false },
        local: { action: "cloned" },
      });
      const directory = await service.localPath(CREATED_ID);
      const original = await service.show(CREATED_ID);
      const edited = await service.edit(CREATED_ID, {
        expectedVersion: original.version,
        description: "Edited",
        files: [
          { name: "beta.txt", content: "beta replacement" },
          { name: "new.txt", content: "new content" },
        ],
        rename: [{ from: "beta.txt", to: "renamed.txt" }],
        remove: ["alpha.txt"],
      });
      expect(edited).toMatchObject({ syncNeeded: true, gist: { description: "Edited" } });
      expect(requests.find((request) => request.method === "PATCH")?.body).toEqual({
        description: "Edited",
        files: {
          "alpha.txt": null,
          "beta.txt": { filename: "renamed.txt", content: "beta replacement" },
          "new.txt": { content: "new content" },
        },
      });
      expect(await service.show(CREATED_ID)).toMatchObject({
        contents: { "renamed.txt": "beta replacement", "new.txt": "new content" },
      });
      await expect(
        service.edit(CREATED_ID, { expectedVersion: original.version, description: "stale" }),
      ).rejects.toThrow("changed on GitHub");
      await expect(
        service.edit(CREATED_ID, { remove: ["renamed.txt", "new.txt"] }),
      ).rejects.toThrow("at least one file");
      await expect(
        service.edit(CREATED_ID, { rename: [{ from: "renamed.txt", to: "new.txt" }] }),
      ).rejects.toThrow("Invalid Gist file rename");
      await expect(service.edit(EXTERNAL_ID, { description: "outsider" })).rejects.toThrow(
        "Only the Gist owner",
      );
      await expect(service.delete(CREATED_ID, false)).rejects.toThrow("Confirm permanent deletion");
      expect(items.has(CREATED_ID)).toBe(true);
      expect(await service.delete(CREATED_ID, true)).toEqual({
        id: CREATED_ID,
        localPath: directory,
      });
      expect(items.has(CREATED_ID)).toBe(false);
      expect(await service.localPath(CREATED_ID)).toBe(directory);
      expect(existsSync(path.join(directory, "same.txt"))).toBe(true);
      expect((await service.list()).find(({ id }) => id === CREATED_ID)).toMatchObject({
        local: "clean",
        gist: null,
      });
      const partialGit = new GistGit(fixture.root, undefined, () => "file:///missing-gist");
      const partial = await new GistService({ ...fixture, github, git: partialGit }).create({
        files,
        public: true,
      });
      expect(partial.gist).toMatchObject({ id: CREATED_ID, public: true });
      expect(partial.local.error).toBeTruthy();
    } finally {
      fixture.cleanup();
    }
  }, 15000);

  test("defaults to personal and all scopes with explicit repository selectors respected", () => {
    expect(autoGistsEnabled({ scope: "user" })).toBe(true);
    expect(autoGistsEnabled({ scope: "all" })).toBe(true);
    expect(autoGistsEnabled({ scope: "org:acme" })).toBe(false);
    expect(autoGistsEnabled({ scope: "user", targeted: true })).toBe(false);
    expect(autoGistsEnabled({ scope: "user", includeGists: false })).toBe(false);
    expect(new GistService({ root: "" }).show(PUBLIC_ID)).rejects.toThrow("Sign in");
  });
});
