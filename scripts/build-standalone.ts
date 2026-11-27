import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(import.meta.dir, "..");
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const platform = process.platform;
const arch = process.arch;
const platforms = {
  linux: { label: "linux", lib: "libopentui.so" },
  darwin: { label: "macos", lib: "libopentui.dylib" },
  win32: { label: "windows", lib: "opentui.dll" },
};
if (!(platform in platforms) || (arch !== "x64" && arch !== "arm64")) {
  throw new Error(`Unsupported standalone build host: ${platform}/${arch}`);
}
const target = platforms[platform as keyof typeof platforms];
const output = path.resolve(process.argv[2] ?? "out/standalone");
const name = `repotruck-${version}-${target.label}-${arch}`;
const directory = path.join(output, name);
const executable = path.join(directory, platform === "win32" ? "repotruck.exe" : "repotruck");
const assets = path.join(directory, "assets");
const opentui = path.join(assets, "opentui");
const nativePackage = `@opentui/core-${platform}-${arch}`;
const nativeRoot = path.dirname(fileURLToPath(import.meta.resolve(nativePackage)));
const coreRoot = path.dirname(fileURLToPath(import.meta.resolve("@opentui/core/node-assets")));
const legacyTreeSitter = fileURLToPath(import.meta.resolve("opentui-tree-sitter/tree-sitter.wasm"));
const modernTreeSitter = fileURLToPath(import.meta.resolve("web-tree-sitter/web-tree-sitter.wasm"));

await mkdir(directory, { recursive: true });
const result = await Bun.build({
  entrypoints: [path.join(root, "src", "standalone.ts")],
  compile: { outfile: executable },
  define: {
    REPOTRUCK_BUILD_VERSION: JSON.stringify(version),
    "process.env.OPENTUI_LIBC": JSON.stringify("glibc"),
  },
  plugins: [
    {
      name: "opentui-tree-sitter-peer",
      setup(build) {
        build.onResolve({ filter: /^web-tree-sitter\/tree-sitter\.wasm$/ }, ({ importer }) => {
          if (importer.replaceAll("\\", "/").includes("/@opentui/core/"))
            return { path: legacyTreeSitter };
        });
      },
    },
  ],
});
if (!result.success) throw new Error(result.logs.map(String).join("\n"));

async function copy(source: string, destination: string) {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

await Promise.all([
  copy(path.join(nativeRoot, target.lib), path.join(opentui, nativePackage, target.lib)),
  copy(path.join(coreRoot, "assets"), path.join(opentui, "@opentui", "core", "assets")),
  copy(
    path.join(coreRoot, "parser.worker.js"),
    path.join(opentui, "@opentui", "core", "parser.worker.js"),
  ),
  copy(legacyTreeSitter, path.join(opentui, "web-tree-sitter", "tree-sitter.wasm")),
  copy(modernTreeSitter, path.join(assets, "web-tree-sitter.wasm")),
  copy(path.join(root, "vendor", "grammars"), path.join(assets, "grammars")),
  copy(path.join(root, "LICENSE"), path.join(directory, "LICENSE")),
  copy(path.join(coreRoot, "LICENSE"), path.join(directory, "licenses", "opentui", "LICENSE")),
  ...(await readdir(nativeRoot))
    .filter((file) => /^(LICENSE|NOTICE|AUTHORS|PATENTS|FFMPEG-SOURCE)/.test(file))
    .map((file) =>
      copy(path.join(nativeRoot, file), path.join(directory, "licenses", "opentui-native", file)),
    ),
]);
await writeFile(path.join(output, "package-directory.txt"), directory);
console.log(`Built ${name}`);
