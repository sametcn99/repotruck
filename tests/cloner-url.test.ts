import { describe, expect, test } from "bun:test";
import { basicAuthExtraHeader, tokenizedUrl } from "../src/services/cloner.ts";

describe("tokenizedUrl", () => {
  test("embeds x-access-token credentials into the https URL", () => {
    expect(tokenizedUrl("https://github.com/octocat/hello.git", "tok_123")).toBe(
      "https://x-access-token:tok_123@github.com/octocat/hello.git",
    );
  });

  test("keeps host and path intact", () => {
    expect(tokenizedUrl("https://github.com/acme/api", "t0k")).toBe(
      "https://x-access-token:t0k@github.com/acme/api",
    );
  });
});

describe("basicAuthExtraHeader", () => {
  test("produces the basic authorization header line", () => {
    expect(basicAuthExtraHeader("tok_123")).toBe(
      `AUTHORIZATION: basic ${Buffer.from("x-access-token:tok_123", "utf8").toString("base64")}`,
    );
  });

  test("only exposes the token base64-encoded", () => {
    const header = basicAuthExtraHeader("sekret-token-value");
    expect(header.startsWith("AUTHORIZATION: basic ")).toBe(true);
    expect(header.includes("sekret-token-value")).toBe(false);
  });
});
