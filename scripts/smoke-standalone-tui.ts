import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const executable = path.resolve(process.argv[2]!);
const root = mkdtempSync(path.join(tmpdir(), "rt-tui-"));
const config = path.join(root, "config");
mkdirSync(config);
writeFileSync(path.join(config, "config.json"), JSON.stringify({ defaultRoot: root }));

const decoder = new TextDecoder();
let transcript = "";
let sentQuit = false;
const child = Bun.spawn([executable], {
  cwd: root,
  env: {
    ...process.env,
    REPOTRUCK_CONFIG_DIR: config,
    REPOTRUCK_OFFLINE: "1",
    REPOTRUCK_NO_AGENTS_MD_MIGRATE: "1",
    REPOTRUCK_NO_UPDATE_CHECK: "1",
    TERM: "xterm-256color",
  },
  terminal: {
    cols: 115,
    rows: 35,
    data(terminal, bytes) {
      transcript += decoder.decode(bytes, { stream: true });
      if (!sentQuit && transcript.includes("Repositories")) {
        sentQuit = true;
        terminal.write("q");
      }
      transcript = transcript.slice(-3500);
    },
  },
});
const timeout = setTimeout(() => child.kill(), 20000);
try {
  const status = await child.exited;
  if (status !== 0 || !sentQuit) {
    throw new Error(`Interactive smoke failed (exit=${status}): ${JSON.stringify(transcript)}`);
  }
  console.log("Standalone TUI rendered Cockpit and exited with q");
} finally {
  clearTimeout(timeout);
  child.terminal?.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
