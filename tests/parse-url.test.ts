import { describe, expect, test } from "bun:test";
import { parseGitUrl } from "../src/services/singleCloner.ts";

describe("parseGitUrl accepted forms", () => {
  test("https URL", () => {
    expect(parseGitUrl("https://github.com/octocat/hello")).toEqual({
      owner: "octocat",
      name: "hello",
    });
  });

  test("https URL with .git suffix", () => {
    expect(parseGitUrl("https://github.com/octocat/hello.git")).toEqual({
      owner: "octocat",
      name: "hello",
    });
  });

  test("http URL", () => {
    expect(parseGitUrl("http://github.com/octocat/hello")).toEqual({
      owner: "octocat",
      name: "hello",
    });
  });

  test("ssh URL with user and .git suffix", () => {
    expect(parseGitUrl("ssh://git@github.com/octocat/hello.git")).toEqual({
      owner: "octocat",
      name: "hello",
    });
  });

  test("scp-like form with .git suffix", () => {
    expect(parseGitUrl("git@github.com:octocat/hello.git")).toEqual({
      owner: "octocat",
      name: "hello",
    });
  });

  test("scp-like form without .git suffix", () => {
    expect(parseGitUrl("git@github.com:octocat/hello")).toEqual({
      owner: "octocat",
      name: "hello",
    });
  });

  test("bare host form", () => {
    expect(parseGitUrl("github.com/octocat/hello")).toEqual({
      owner: "octocat",
      name: "hello",
    });
  });

  test("bare host form with .git suffix", () => {
    expect(parseGitUrl("github.com/octocat/hello.git")).toEqual({
      owner: "octocat",
      name: "hello",
    });
  });

  test("short owner/repo form", () => {
    expect(parseGitUrl("octocat/hello")).toEqual({ owner: "octocat", name: "hello" });
  });

  test("short form with .git suffix", () => {
    expect(parseGitUrl("octocat/hello.git")).toEqual({ owner: "octocat", name: "hello" });
  });

  test("host is case-insensitive while owner and name keep their case", () => {
    expect(parseGitUrl("https://GITHUB.COM/OctoCat/Hello.World")).toEqual({
      owner: "OctoCat",
      name: "Hello.World",
    });
    expect(parseGitUrl("GiTHuB.com/octocat/hello")).toEqual({
      owner: "octocat",
      name: "hello",
    });
  });

  test("repo names with dots, underscores and dashes", () => {
    expect(parseGitUrl("octocat/my_repo.v2-dev")).toEqual({
      owner: "octocat",
      name: "my_repo.v2-dev",
    });
  });
});

describe("parseGitUrl rejected forms", () => {
  test("wrong host in URL", () => {
    expect(parseGitUrl("https://gitlab.com/octocat/hello")).toBeNull();
  });

  test("wrong host in scp-like form", () => {
    expect(parseGitUrl("git@myhost.com:octocat/hello.git")).toBeNull();
  });

  test("wrong host in bare form", () => {
    expect(parseGitUrl("gitlab.com/octocat/hello")).toBeNull();
  });

  test("missing repo", () => {
    expect(parseGitUrl("https://github.com/octocat")).toBeNull();
  });

  test("too many segments", () => {
    expect(parseGitUrl("octocat/hello/extra")).toBeNull();
  });

  test("repo with illegal characters", () => {
    expect(parseGitUrl("octocat/hello?world")).toBeNull();
    expect(parseGitUrl("octocat/hello world")).toBeNull();
  });

  test("owner starting with a dash", () => {
    expect(parseGitUrl("-octocat/hello")).toBeNull();
  });

  test("owner ending with a dash", () => {
    expect(parseGitUrl("octocat-/hello")).toBeNull();
  });

  test("owner longer than 39 characters", () => {
    expect(parseGitUrl(`${"a".repeat(40)}/hello`)).toBeNull();
  });

  test("repo starting with a dash", () => {
    expect(parseGitUrl("octocat/-hello")).toBeNull();
  });

  test("owner missing entirely", () => {
    expect(parseGitUrl("/hello")).toBeNull();
  });

  test("bare repo name without owner", () => {
    expect(parseGitUrl("hello")).toBeNull();
  });

  test("empty input", () => {
    expect(parseGitUrl("")).toBeNull();
    expect(parseGitUrl("   ")).toBeNull();
  });

  test("garbage scheme", () => {
    expect(parseGitUrl("https://")).toBeNull();
  });
});
