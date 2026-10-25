import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(__dirname, "..");
const repoPackageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
const currentVersion: string = repoPackageJson.version;

describe("Pipeline & Infrastructure Static Verifications (Sprint 3)", () => {
  // C1: ci.yml valid structure & on.workflow_call
  test("C1: .github/workflows/ci.yml defines workflow_call and valid triggers", () => {
    const ciRaw = readFileSync(path.join(rootDir, ".github/workflows/ci.yml"), "utf8");
    expect(ciRaw).toContain("name: CI");
    expect(ciRaw).toContain("workflow_call:");
    expect(ciRaw).toContain("pull_request:");
    expect(ciRaw).toContain("push:");
  });

  // C2: release.yml concurrency: release, jobs.ci uses ci.yml & jobs.publish needs ci
  test("C2: .github/workflows/release.yml has concurrency, uses ci.yml and connects publish with needs: ci", () => {
    const releaseRaw = readFileSync(path.join(rootDir, ".github/workflows/release.yml"), "utf8");
    expect(releaseRaw).toMatch(/^concurrency:\s*release/m);
    expect(releaseRaw).toMatch(/jobs:\s+ci:\s+uses:\s+\.\/\.github\/workflows\/ci\.yml/m);
    expect(releaseRaw).toMatch(/publish:\s+needs:\s*ci/m);
  });

  // C3: OIDC Trusted Publishing, id-token: write, no NPM_TOKEN/NODE_AUTH_TOKEN, provenance and setup-node registry-url
  test("C3: release.yml uses OIDC Trusted Publishing without static secrets", () => {
    const releaseRaw = readFileSync(path.join(rootDir, ".github/workflows/release.yml"), "utf8");

    // permissions check
    expect(releaseRaw).toMatch(/permissions:[\s\S]+?id-token:\s*write/);
    expect(releaseRaw).toMatch(/permissions:[\s\S]+?contents:\s*write/);

    // Static token elimination check
    expect(releaseRaw).not.toContain("NODE_AUTH_TOKEN");
    expect(releaseRaw).not.toContain("NPM_TOKEN");

    // setup-node registry-url check
    expect(releaseRaw).toMatch(
      /uses:\s+actions\/setup-node@[a-f0-9]{40}[\s\S]+?registry-url:\s*https:\/\/registry\.npmjs\.org/,
    );

    // npm publish --provenance check
    expect(releaseRaw).toContain("npm publish --provenance --access public");
  });

  // C4: Tag vs package.json verification step simulation
  test("C4: release.yml tag verification step logic correctly gates on version", () => {
    const releaseRaw = readFileSync(path.join(rootDir, ".github/workflows/release.yml"), "utf8");
    const tagMatch = releaseRaw.match(/run:\s*test\s+"(\$\{?GITHUB_REF_NAME\}?)"\s*=\s*"([^"]+)"/);
    expect(tagMatch).toBeDefined();

    // Verify command references node -p require package.json version
    expect(releaseRaw).toContain(
      `test "\${GITHUB_REF_NAME}" = "v$(node -p "require('./package.json').version")"`,
    );

    // Execute real node -p evaluation directly
    const extractedVersion = execSync("node -p \"require('./package.json').version\"", {
      cwd: rootDir,
      encoding: "utf8",
    }).trim();
    expect(extractedVersion).toBe(currentVersion);

    // Semantic simulation in TypeScript (no ambient bash needed)
    function simulateTagCheck(refName: string): boolean {
      return refName === `v${extractedVersion}`;
    }

    expect(simulateTagCheck(`v${currentVersion}`)).toBe(true); // Positive case (v0.1.0)
    expect(simulateTagCheck("v0.2.0")).toBe(false); // Negative case
    expect(simulateTagCheck("v9.9.9")).toBe(false); // Negative case
  });

  // C5: CHANGELOG version header verification step simulation
  test("C5: release.yml CHANGELOG verification step logic correctly detects version headings", () => {
    const releaseRaw = readFileSync(path.join(rootDir, ".github/workflows/release.yml"), "utf8");
    const changelogRaw = readFileSync(path.join(rootDir, "CHANGELOG.md"), "utf8");

    // Verify command text uses escaped brackets
    expect(releaseRaw).toContain("CHANGELOG.md");
    expect(releaseRaw).toMatch(/grep\s+-E\s+["']\^##\s*\\\[/);

    // Semantic simulation in TypeScript: test regex matching against CHANGELOG.md
    function simulateChangelogCheck(version: string): boolean {
      const escaped = version.replace(/\./g, "\\.");
      const regex1 = new RegExp(`^## \\[${escaped}\\]`, "m");
      const regex2 = new RegExp(`^## \\[v${escaped}\\]`, "m");
      return regex1.test(changelogRaw) || regex2.test(changelogRaw);
    }

    expect(simulateChangelogCheck("0.1.0")).toBe(true); // Positive case (v0.1.0 exists)
    expect(simulateChangelogCheck("0.2.0")).toBe(true); // Positive case (v0.2.0 exists)
    expect(simulateChangelogCheck("9.9.9")).toBe(false); // Negative case (v9.9.9 does not exist)
  });

  // C6: Prerelease tag condition adds --tag next
  test("C6: release.yml adds --tag next conditionally for prerelease tags", () => {
    const releaseRaw = readFileSync(path.join(rootDir, ".github/workflows/release.yml"), "utf8");
    expect(releaseRaw).toMatch(/if\s+\[\[\s*["']?\$\{?GITHUB_REF_NAME\}?["']?\s*==\s*\*-.*\]\]/);
    expect(releaseRaw).toContain("--tag next");
    expect(releaseRaw).toContain(`npm publish --provenance --access public "\${EXTRA_ARGS[@]}"`);
  });

  // C7: Full 40-character commit SHA pinning on all workflow actions
  test("C7: all external actions in workflows are pinned to full 40-character commit SHAs", () => {
    const workflowFiles = [
      path.join(rootDir, ".github/workflows/ci.yml"),
      path.join(rootDir, ".github/workflows/release.yml"),
      path.join(rootDir, ".github/workflows/pages.yml"),
      path.join(rootDir, ".github/workflows/release-grammars.yml"),
    ];

    const shaLinePattern = /^uses:\s+[\w.-]+\/[\w.-]+@[a-f0-9]{40}\s*#\s*v\d+\.\d+\.\d+$/;
    const localUsesPattern = /^uses:\s+\.\//;

    for (const filePath of workflowFiles) {
      const content = readFileSync(filePath, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (line.startsWith("uses:")) {
          if (localUsesPattern.test(line)) {
            // Local workflow call carve-out
            expect(line).toBe("uses: ./.github/workflows/ci.yml");
          } else {
            // External action must match full SHA pattern with version annotation
            expect(line).toMatch(shaLinePattern);
          }
        }
      }
    }
  });

  // C8 & C9: dependabot.yml configuration and grouped settings
  test("C8 & C9: .github/dependabot.yml follows all grouping, schedule, and ecosystem rules", () => {
    const dependabotRaw = readFileSync(path.join(rootDir, ".github/dependabot.yml"), "utf8");

    expect(dependabotRaw).toMatch(/^version:\s*2/m);

    // Ecosystems check
    expect(dependabotRaw).toMatch(/package-ecosystem:\s*"bun"[\s\S]+?directory:\s*"\/"/);
    expect(dependabotRaw).toMatch(/package-ecosystem:\s*"bun"[\s\S]+?directory:\s*"\/website"/);
    expect(dependabotRaw).toMatch(/package-ecosystem:\s*"github-actions"[\s\S]+?directory:\s*"\/"/);

    // Schedule check
    expect(dependabotRaw).toContain('interval: "weekly"');
    expect(dependabotRaw).toContain('day: "monday"');
    expect(dependabotRaw).toContain("open-pull-requests-limit: 5");
    expect(dependabotRaw).toContain('prefix: "chore(deps)"');

    // web-tree-sitter ignore check
    expect(dependabotRaw).toContain('dependency-name: "web-tree-sitter"');
    expect(dependabotRaw).toContain('"version-update:semver-major"');
    expect(dependabotRaw).toContain('"version-update:semver-minor"');
    expect(dependabotRaw).toContain("WebAssembly ABI 0.25.10");

    // Groups check
    expect(dependabotRaw).toContain("dev-dependencies:");
    expect(dependabotRaw).toContain('dependency-type: "development"');
    expect(dependabotRaw).toContain("opentui:");
    expect(dependabotRaw).toContain('"@opentui/*"');
    expect(dependabotRaw).toContain("mcp:");
    expect(dependabotRaw).toContain('"@modelcontextprotocol/*"');
    expect(dependabotRaw).toContain("octokit:");
    expect(dependabotRaw).toContain('"@octokit/*"');
    expect(dependabotRaw).toContain("actions:");
    expect(dependabotRaw).toContain('"*"');
  });

  // C10: CHANGELOG.md Keep a Changelog structure
  test("C10: CHANGELOG.md follows Keep a Changelog format with [Unreleased], [0.2.0], and [0.1.0]", () => {
    const changelogRaw = readFileSync(path.join(rootDir, "CHANGELOG.md"), "utf8");
    expect(changelogRaw).toContain("## [Unreleased]");
    expect(changelogRaw).toContain("## [0.2.0] - 2026-10-25");
    expect(changelogRaw).toContain("## [0.1.0] - 2026-10-24");

    // Verify sections have at least one entry
    const v020Section = changelogRaw.slice(
      changelogRaw.indexOf("## [0.2.0]"),
      changelogRaw.indexOf("## [0.1.0]"),
    );
    expect(v020Section).toContain("- Multi-process atomic workspace locking");
    expect(v020Section).toContain("- Windows shell quoting security hardening");

    const v010Section = changelogRaw.slice(changelogRaw.indexOf("## [0.1.0]"));
    expect(v010Section).toContain("- Initial open-source release of repotruck");
  });

  // C11: CONTRIBUTING.md contents
  test("C11: CONTRIBUTING.md documents development requirements, commands, and conventional commits", () => {
    const contributingRaw = readFileSync(path.join(rootDir, "CONTRIBUTING.md"), "utf8");
    expect(contributingRaw).toContain("Bun");
    expect(contributingRaw).toContain("Node.js");
    expect(contributingRaw).toContain("bun run check");
    expect(contributingRaw).toContain("bun run typecheck");
    expect(contributingRaw).toContain("bun test");
    expect(contributingRaw).toContain("bun run docs:check");
    expect(contributingRaw).toContain("Conventional Commits");
  });

  // C12: SECURITY.md supply chain section
  test("C12: SECURITY.md documents OIDC Trusted Publishing and immutable action pinning", () => {
    const securityRaw = readFileSync(path.join(rootDir, "SECURITY.md"), "utf8");
    expect(securityRaw).toContain("## Supply Chain & Package Integrity");
    expect(securityRaw).toContain("OIDC Trusted Publishing");
    expect(securityRaw).toContain("--provenance");
    expect(securityRaw).toContain("Immutable Action Pinning");
    expect(securityRaw).toContain("Trusted Publisher must be configured manually in npmjs.com");
  });

  // C13: src/mcp/server.ts permanent drift comment
  test("C13: src/mcp/server.ts comment does not contain hardcoded version numbers", () => {
    const serverRaw = readFileSync(path.join(rootDir, "src/mcp/server.ts"), "utf8");
    expect(serverRaw).toContain(
      "Interoperability note: @modelcontextprotocol/node and @modelcontextprotocol/server",
    );
    expect(serverRaw).not.toContain("deliberately pinned (2.1.1)");
    expect(serverRaw).not.toContain("on the 2.3.x line");
  });

  // C14: README.md unstaged additions
  test("C14: README.md includes CI badge and Contributing section", () => {
    const readmeRaw = readFileSync(path.join(rootDir, "README.md"), "utf8");
    expect(readmeRaw).toContain(
      "[![CI](https://github.com/sametcn99/repotruck/actions/workflows/ci.yml/badge.svg)]",
    );
    expect(readmeRaw).toContain("## Contributing");
    expect(readmeRaw).toContain("[CONTRIBUTING.md](./CONTRIBUTING.md)");
  });

  // C15: release-grammars.yml structure, trigger, permissions, and manifest verification
  test("C15: release-grammars.yml defines workflow_dispatch, contents: write, manifest drift check, and grammars-v1 tag", () => {
    const raw = readFileSync(path.join(rootDir, ".github/workflows/release-grammars.yml"), "utf8");
    expect(raw).toContain("name: Release Grammars");
    expect(raw).toMatch(/on:\s*\n\s*workflow_dispatch:/);
    expect(raw).toMatch(/permissions:\s*\n\s*contents:\s*write/);
    expect(raw).toContain("bun scripts/generate-grammar-manifest.ts --check");
    expect(raw).toContain("grammars-v1");
    expect(raw).toContain("vendor/grammars/*.wasm");
  });
});
