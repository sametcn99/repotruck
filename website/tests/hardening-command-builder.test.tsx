import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import {
  buildCommand,
  parseUsageForm,
  quoteValue,
  splitArguments,
} from "../src/components/CommandBuilder.tsx";

describe("[E68] copied command argument integrity", () => {
  test("POSIX shell round-trips whitespace, quotes, Unicode and metacharacters without expansion", () => {
    const args = [
      "",
      " space value ",
      'double"quote',
      "single'quote",
      "$HOME",
      "$(printf injected)",
      "`printf injected`",
      "a;b",
      "a&b",
      "*",
      "ş🙂",
      "line\nvalue",
      "trailing\\",
    ];
    const command = `${quoteValue(process.execPath)} -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- ${args.map(quoteValue).join(" ")}`;
    if (process.platform !== "win32")
      expect(JSON.parse(execFileSync("/bin/sh", ["-c", command], { encoding: "utf8" }))).toEqual(
        args,
      );
    expect(quoteValue(" leading and trailing ")).toBe('" leading and trailing "');
  });
  test("variadic groups and partial quoted edits preserve meaningful argument boundaries", () => {
    expect(splitArguments('one "two words" \'literal $HOME\' ""')).toEqual([
      "one",
      "two words",
      "literal $HOME",
      "",
    ]);
    expect(splitArguments('"unfinished edit')).toEqual(["unfinished edit"]);
    expect(
      buildCommand(
        parseUsageForm("repotruck run <command...>"),
        ['node "file with spaces.js" "$(id)"'],
        [],
        [],
      ),
    ).toBe('npx repotruck run node "file with spaces.js" "\\$(id)"');
  });
});
