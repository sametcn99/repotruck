/**
 * Builds a single shell command string from a command and its arguments so
 * that spawning through a shell (needed for `.cmd`/`.bat` shims on Windows
 * and for ENOENT fallbacks) can never reinterpret argument content as shell
 * syntax.
 */

const POSIX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const WINDOWS_UNSAFE = /[\s"&|<>^]/;

function quotePosixArg(value: string): string {
  if (value.length === 0) return "''";
  if (POSIX_SAFE.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function quoteWindowsArg(value: string): string {
  if (value.length === 0) return '""';
  if (!WINDOWS_UNSAFE.test(value)) return value;
  // Inside double quotes cmd.exe treats & | < > ^ literally; embedded double
  // quotes are escaped by doubling.
  return `"${value.replace(/"/g, '""')}"`;
}

export function quoteForShell(
  command: string,
  args: readonly string[],
  platform: string = process.platform,
): string {
  const quote = platform === "win32" ? quoteWindowsArg : quotePosixArg;
  return [command, ...args].map(quote).join(" ");
}
