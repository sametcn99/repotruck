/**
 * Builds a single shell command string from a command and its arguments so
 * that spawning through a shell (needed for `.cmd`/`.bat` shims on Windows
 * and for ENOENT fallbacks) can never reinterpret argument content as shell
 * syntax.
 */

export class ShellQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShellQuoteError";
  }
}

export interface QuoteForShellOptions {
  platform?: string;
  cmdShim?: boolean;
}

export function isCmdShim(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command);
}

const POSIX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const metaCharsRegExp = /([()\][%!^"`<>&|;, *?])/g;

function quotePosixArg(value: string): string {
  if (value.length === 0) return "''";
  if (POSIX_SAFE.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function escapeCommand(command: string): string {
  return command.replace(metaCharsRegExp, "^$1");
}

export function escapeArgument(arg: string, doubleEscapeMetaChars?: boolean): string {
  let value = `${arg}`;

  // Sequence of backslashes followed by a double quote:
  // double up all the backslashes and escape the double quote (2N + 1 backslashes)
  value = value.replace(/(\\*)(")/g, "$1$1\\$2");

  // Sequence of backslashes followed by the end of the string
  // (which will become a double quote later):
  // double up all the backslashes (2N backslashes)
  value = value.replace(/(\\+)$/g, "$1$1");

  // Quote the whole thing:
  value = `"${value}"`;

  // Escape meta chars
  value = value.replace(metaCharsRegExp, "^$1");

  // Double escape meta chars if necessary
  if (doubleEscapeMetaChars) {
    value = value.replace(metaCharsRegExp, "^$1");
  }

  return value;
}

export function quoteForShell(
  command: string,
  args: readonly string[],
  platformOrOptions?: string | QuoteForShellOptions,
): string {
  const options: QuoteForShellOptions =
    typeof platformOrOptions === "object" ? platformOrOptions : { platform: platformOrOptions };
  const platform = options.platform ?? process.platform;

  if (platform === "win32") {
    if (command.includes("\r") || command.includes("\n")) {
      throw new ShellQuoteError(
        `Command token contains carriage return or newline which cannot be safely escaped for cmd.exe: ${JSON.stringify(command)}`,
      );
    }

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg.includes("\r") || arg.includes("\n")) {
        throw new ShellQuoteError(
          `Argument at index ${i} contains carriage return or newline which cannot be safely escaped for cmd.exe: ${JSON.stringify(arg)}`,
        );
      }
    }

    const doubleEscape = options.cmdShim === true;
    const escapedCommand = escapeCommand(command);
    const escapedArgs = args.map((arg) => escapeArgument(arg, doubleEscape));
    return [escapedCommand, ...escapedArgs].join(" ");
  }

  return [quotePosixArg(command), ...args.map(quotePosixArg)].join(" ");
}
