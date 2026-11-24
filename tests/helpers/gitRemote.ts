import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { simpleGit } from "simple-git";
import type { workspaceFixture } from "./hardening.ts";

export async function gitRemoteFixture(f: ReturnType<typeof workspaceFixture>) {
  const sourceDir = path.join(f.base, "source"),
    bareDir = path.join(f.base, "remote.git");
  mkdirSync(sourceDir);
  const source = simpleGit({ baseDir: sourceDir, allowConfig: ["commit.gpgsign"] });
  await source.init(["-b", "main"]);
  await source.addConfig("user.name", "Fixture");
  await source.addConfig("user.email", "fixture@repotruck.test");
  await source.addConfig("commit.gpgsign", "false");
  writeFileSync(path.join(sourceDir, ".gitattributes"), "* -text\n");
  mkdirSync(path.join(sourceDir, "src"));
  mkdirSync(path.join(sourceDir, "docs"));
  writeFileSync(path.join(sourceDir, "same.txt"), "initial\n");
  writeFileSync(path.join(sourceDir, "src/main.ts"), "export const value = 1;\n");
  writeFileSync(path.join(sourceDir, "docs/guide.md"), "guide\n");
  await source.add(".");
  await source.commit("initial");
  await simpleGit().raw(["clone", "--bare", sourceDir, bareDir]);
  const url = pathToFileURL(bareDir).href;
  await source.addRemote("origin", url);
  await source.push(["-u", "origin", "main"]);
  const bare = simpleGit({ baseDir: bareDir, allowConfig: ["uploadpack.allowfilter"] });
  const target = { owner: "acme", name: "api", httpsUrl: url, sshUrl: url, destDir: f.repoDir };
  return {
    source,
    sourceDir,
    bare,
    bareDir,
    url,
    target,
    async commit(file: string, text: string) {
      writeFileSync(path.join(sourceDir, file), text);
      await source.add(".");
      await source.commit(`update ${file}`);
      await source.push();
    },
  };
}
