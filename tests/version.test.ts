import { describe, expect, test } from "bun:test";
import { isNewerVersion } from "../src/services/version.ts";

describe("isNewerVersion", () => {
  test("release beats prerelease of the same core version", () => {
    expect(isNewerVersion("1.2.4", "1.2.4-beta")).toBe(true);
  });

  test("prerelease loses to release of the same core version", () => {
    expect(isNewerVersion("1.2.4-beta", "1.2.4")).toBe(false);
  });

  test("stable release over its own release candidate", () => {
    expect(isNewerVersion("2.0.0", "2.0.0-rc.1")).toBe(true);
  });

  test("higher numeric prerelease identifier wins", () => {
    expect(isNewerVersion("1.2.4-beta.2", "1.2.4-beta.1")).toBe(true);
  });

  test("alphanumeric prerelease identifiers compare lexically", () => {
    expect(isNewerVersion("1.2.4-beta", "1.2.4-alpha.9")).toBe(true);
  });

  test("numeric prerelease identifiers compare numerically, not lexically", () => {
    expect(isNewerVersion("1.2.4-2", "1.2.4-10")).toBe(false);
  });

  test("build metadata is ignored entirely", () => {
    expect(isNewerVersion("1.2.4+build.1", "1.2.4")).toBe(false);
  });

  test("prerelease of a higher core version is still newer", () => {
    expect(isNewerVersion("1.3.0-rc.1", "1.2.9")).toBe(true);
  });

  test("prerelease of a lower core version is not newer than a prerelease of a higher core", () => {
    expect(isNewerVersion("1.2.3", "1.2.4-beta")).toBe(false);
  });

  test("fewer prerelease identifiers mean lower precedence", () => {
    expect(isNewerVersion("1.2.4-alpha", "1.2.4-alpha.1")).toBe(false);
  });

  test("more prerelease identifiers mean higher precedence", () => {
    expect(isNewerVersion("1.2.4-alpha.1", "1.2.4-alpha")).toBe(true);
  });

  test("null and empty candidates are never newer", () => {
    expect(isNewerVersion(null, "1.2.3")).toBe(false);
    expect(isNewerVersion("", "1.2.3")).toBe(false);
  });

  test("identical versions are not newer", () => {
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
    expect(isNewerVersion("1.2.3-1", "1.2.3-1")).toBe(false);
  });

  test("plain higher versions are newer", () => {
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
  });

  test("non-semver input is never newer", () => {
    expect(isNewerVersion("latest", "1.2.3")).toBe(false);
    expect(isNewerVersion("1.2", "1.2.3")).toBe(false);
  });
});
