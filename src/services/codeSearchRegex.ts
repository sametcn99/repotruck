import { Worker } from "node:worker_threads";

/** Regex execution never shares the TUI/MCP event loop with untrusted patterns. */
export class BoundedRegex {
  private readonly worker: Worker;
  private failed = false;
  private startupError: Error | null = null;
  constructor(pattern: string) {
    if (pattern.length > 4096) throw new Error("regex pattern exceeds 4096 characters");
    try {
      new RegExp(pattern, "i");
    } catch {
      throw new Error(`invalid regex pattern: ${pattern}`);
    }
    this.worker = new Worker(
      `const { parentPort, workerData } = require('node:worker_threads');
      const regex = new RegExp(workerData, 'i');
      parentPort.on('message', lines => parentPort.postMessage(lines.map(line => regex.test(line))));`,
      { eval: true, workerData: pattern, execArgv: [] },
    );
    this.worker.on("error", (error) => {
      this.startupError = error instanceof Error ? error : new Error(String(error));
      this.failed = true;
    });
  }

  test(lines: string[]): Promise<boolean[]> {
    if (this.failed)
      return Promise.reject(this.startupError ?? new Error("regex search has stopped"));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.worker.off("message", success);
        this.worker.off("error", failure);
        this.worker.off("exit", exited);
      };
      const success = (matches: boolean[]) => {
        cleanup();
        resolve(matches);
      };
      const failure = (error: Error) => {
        cleanup();
        this.failed = true;
        reject(error);
      };
      const exited = () => failure(new Error("regex worker exited before completing search"));
      const timer = setTimeout(() => {
        failure(
          new Error("regex search exceeded the 1000ms execution limit; simplify the pattern"),
        );
        void this.worker.terminate();
      }, 1000);
      this.worker.once("message", success);
      this.worker.once("error", failure);
      this.worker.once("exit", exited);
      this.worker.postMessage(lines);
    });
  }

  async close(): Promise<void> {
    await this.worker.terminate();
  }
}
