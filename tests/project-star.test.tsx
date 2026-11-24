import { afterEach, describe, expect, mock, test } from "bun:test";
import { Octokit } from "@octokit/rest";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store } from "../src/components/store.ts";
import { diagSnapshot } from "../src/services/diagnostics.ts";
import { GitHubService } from "../src/services/github.ts";
import type { RateLimitRetryOptions } from "../src/services/rateLimit.ts";
import { storeDeps, waitUntil, workspaceFixture } from "./helpers/hardening.ts";
import { testRender } from "./helpers/render.tsx";

const fixtures: ReturnType<typeof workspaceFixture>[] = [],
  stores: Store[] = [];
const oldConfig = process.env.REPOTRUCK_CONFIG_DIR;
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  if (oldConfig === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = oldConfig;
  for (const f of fixtures.splice(0)) f.cleanup();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function client(
  fetch: (url: string | URL | Request, options?: RequestInit) => Promise<Response>,
  baseUrl?: string,
  retry?: RateLimitRetryOptions,
) {
  const octokit = new Octokit({
    auth: "test-session-only",
    baseUrl,
    request: { fetch },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return new GitHubService("unused", { octokit, retry });
}
async function makeStore(
  check: (signal?: AbortSignal) => Promise<boolean>,
  star: (signal?: AbortSignal) => Promise<void> = async () => {},
) {
  const f = workspaceFixture();
  fixtures.push(f);
  process.env.REPOTRUCK_CONFIG_DIR = f.configDir;
  await f.save();
  const base = storeDeps();
  const github = { ...base.github!("test"), isProjectStarred: check, starProject: star };
  const store = new Store(f.root, { ...base, github: () => github });
  stores.push(store);
  await store.init();
  store.setView("about");
  return { store, f };
}
async function render(store: Store) {
  const setup = await testRender(
    <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
    { width: 110, height: 36 },
  );
  await setup.flush();
  return setup;
}

describe("[E74] authenticated project star transport", () => {
  test("the production logger treats an unstarred 404 as information without a FAILED toast", async () => {
    const before = diagSnapshot().at(-1)?.id ?? 0;
    const github = new GitHubService("test-session-only", {
      request: { fetch: async () => new Response(null, { status: 404 }) },
    });
    expect(await github.isProjectStarred()).toBe(false);
    const logs = diagSnapshot().filter((entry) => entry.id > before);
    expect(
      logs.some((entry) => entry.message.includes("/user/starred/") && entry.level === "info"),
    ).toBe(true);
    expect(logs.some((entry) => entry.level === "error")).toBe(false);
  });
  test("fresh GET distinguishes 204/404 and PUT preserves session auth, target and empty body", async () => {
    let starred = false;
    const requests: { method: string; path: string }[] = [];
    const github = client(async (url, options) => {
      const request =
        url instanceof Request ? new Request(url, options) : new Request(String(url), options);
      requests.push({ method: request.method, path: new URL(request.url).pathname });
      expect(request.headers.get("authorization")).toBe("token test-session-only");
      expect(request.headers.get("if-none-match")).toBeNull();
      if (request.method === "PUT") {
        expect(request.headers.get("content-length")).toBe("0");
        expect(await request.text()).toBe("");
        starred = true;
      }
      return new Response(null, { status: starred ? 204 : 404 });
    });
    expect(await github.isProjectStarred()).toBe(false);
    await github.starProject();
    expect(await github.isProjectStarred()).toBe(true);
    expect(requests).toEqual(
      ["GET", "PUT", "GET"].map((method) => ({
        method,
        path: "/user/starred/sametcn99/repotruck",
      })),
    );
  });
  for (const status of [401, 403, 429, 500])
    test(`GET ${status} is an error, never an unstarred result or leaked token`, async () => {
      const github = client(
        async () =>
          new Response(JSON.stringify({ message: "test-session-only" }), {
            status,
            headers: { "content-type": "application/json" },
          }),
        undefined,
        status === 429 ? { maxRateLimitRetries: 0 } : undefined,
      );
      await expect(github.isProjectStarred()).rejects.toThrow(
        status === 401
          ? "Sign in again"
          : status === 403
            ? "Starring permissions"
            : status === 429
              ? "rate limit"
              : "could not confirm",
      );
    });
  test("a failed PUT and an unconfirmed success are not treated as a confirmed star", async () => {
    for (const status of [403, 404, 500, 200]) {
      const github = client(async () => new Response(null, { status }));
      await expect(github.starProject()).rejects.toThrow();
    }
  });
  test("an enterprise session never sends credentials to another host or stars a same-name enterprise repo", async () => {
    const transport = mock(async () => new Response(null, { status: 204 }));
    const github = client(transport, "https://enterprise.invalid/api/v3");
    await expect(github.isProjectStarred()).rejects.toThrow("github.com session");
    await expect(github.starProject()).rejects.toThrow("github.com session");
    expect(transport).not.toHaveBeenCalled();
  });
  test("transport cancellation propagates to the SDK request", async () => {
    const controller = new AbortController();
    const github = client(async (_url, options) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      throw new Error("cancelled transport");
    });
    await expect(github.isProjectStarred(controller.signal)).rejects.toThrow();
    expect(controller.signal.aborted).toBe(true);
  });
});

describe("[E74] About star interaction and ownership", () => {
  test("one mouse click stars with the active session, blocks duplicate input and hides only after GET confirms", async () => {
    let starred = false;
    const write = deferred<void>();
    const check = mock(async () => starred);
    const star = mock(async () => {
      await write.promise;
      starred = true;
    });
    const { store } = await makeStore(check, star);
    const setup = await render(store);
    try {
      await waitUntil(() => store.getSnapshot().projectStar.status === "available");
      await setup.flush();
      const rows = setup.captureCharFrame().split("\n"),
        y = rows.findIndex((row) => row.includes("Give star [s"));
      expect(y).toBeGreaterThanOrEqual(0);
      await setup.mockMouse.click(rows[y]!.indexOf("Give star"), y);
      await setup.mockInput.pressKey("s");
      await setup.mockInput.pressEnter();
      await waitUntil(() => star.mock.calls.length === 1);
      await setup.flush();
      expect(store.getSnapshot().projectStar.status).toBe("submitting");
      expect(setup.captureCharFrame()).not.toContain("Give star [s");
      write.resolve();
      await waitUntil(() => store.getSnapshot().projectStar.status === "starred");
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("Thanks for your star!");
      expect(setup.captureCharFrame()).not.toContain("Give star [s");
      expect(star).toHaveBeenCalledTimes(1);
      expect(check).toHaveBeenCalledTimes(3);
      await store.giveProjectStar();
      expect(star).toHaveBeenCalledTimes(1);
    } finally {
      await setup.dispose();
    }
  });
  for (const key of ["s", "return"])
    test(`${key} provides the same single-action keyboard path`, async () => {
      let starred = false;
      const star = mock(async () => {
        starred = true;
      });
      const { store } = await makeStore(async () => starred, star),
        setup = await render(store);
      try {
        await waitUntil(() => store.getSnapshot().projectStar.status === "available");
        if (key === "return") await setup.mockInput.pressEnter();
        else await setup.mockInput.pressKey(key);
        await waitUntil(() => store.getSnapshot().projectStar.status === "starred");
        expect(star).toHaveBeenCalledTimes(1);
      } finally {
        await setup.dispose();
      }
    });
  test("already-starred accounts never see the button; reopening About rechecks an external unstar", async () => {
    let starred = true;
    const star = mock(async () => {}),
      check = mock(async () => starred);
    const { store } = await makeStore(check, star),
      setup = await render(store);
    try {
      await waitUntil(() => store.getSnapshot().projectStar.status === "starred");
      await setup.flush();
      expect(setup.captureCharFrame()).not.toContain("Give star [s");
      await setup.mockInput.pressKey("s");
      expect(star).not.toHaveBeenCalled();
      store.setView("cockpit");
      await setup.flush();
      starred = false;
      store.setView("about");
      await setup.flush();
      await waitUntil(() => store.getSnapshot().projectStar.status === "available");
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("Give star [s");
      expect(check).toHaveBeenCalledTimes(2);
    } finally {
      await setup.dispose();
    }
  });
  test("no star action appears before a pending check, or after a check failure; r safely retries", async () => {
    const pending = deferred<boolean>();
    let mode: "pending" | "error" | "available" = "pending";
    const { store } = await makeStore(async () => {
        if (mode === "error") throw new Error("Permission check failed");
        if (mode === "available") return false;
        return pending.promise;
      }),
      setup = await render(store);
    try {
      expect(store.getSnapshot().projectStar.status).toBe("checking");
      expect(setup.captureCharFrame()).not.toContain("Give star [s");
      store.cancelProjectStar();
      mode = "error";
      await store.refreshProjectStar();
      await setup.flush();
      expect(store.getSnapshot().projectStar.status).toBe("error");
      expect(setup.captureCharFrame()).not.toContain("Give star [s");
      mode = "available";
      await setup.mockInput.pressKey("r");
      await waitUntil(() => store.getSnapshot().projectStar.status === "available");
      pending.resolve(true);
      await setup.flush();
      expect(store.getSnapshot().projectStar.status).toBe("available");
    } finally {
      pending.resolve(false);
      await setup.dispose();
    }
  });
  test("PUT success followed by a negative verification stays unconfirmed and can be rechecked", async () => {
    const star = mock(async () => {});
    const { store } = await makeStore(async () => false, star);
    await store.refreshProjectStar();
    await store.giveProjectStar();
    expect(star).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().projectStar.status).toBe("error");
    expect(store.getSnapshot().projectStar.message).toContain("not confirmed");
    await store.refreshProjectStar();
    expect(store.getSnapshot().projectStar.status).toBe("available");
  });
  test("a star given externally after the check is hidden without an unnecessary PUT", async () => {
    let starred = false;
    const star = mock(async () => {}),
      { store } = await makeStore(async () => starred, star);
    await store.refreshProjectStar();
    starred = true;
    await store.giveProjectStar();
    expect(store.getSnapshot().projectStar.status).toBe("starred");
    expect(star).not.toHaveBeenCalled();
  });
  test("offline mode cancels a pending request and ignores its late result", async () => {
    const pending = deferred<boolean>();
    let signal: AbortSignal | undefined;
    const star = mock(async () => {}),
      { store } = await makeStore(async (value) => {
        signal = value;
        return pending.promise;
      }, star);
    const check = store.refreshProjectStar();
    await store.enterOfflineMode();
    pending.resolve(false);
    await check;
    expect(signal?.aborted).toBe(true);
    expect(store.getSnapshot().projectStar.status).toBe("unavailable");
    await store.giveProjectStar();
    expect(star).not.toHaveBeenCalled();
  });
  test("leaving during the preflight check prevents a later PUT", async () => {
    const pending = deferred<boolean>();
    let count = 0;
    const star = mock(async () => {}),
      { store } = await makeStore(async () => (++count === 1 ? false : pending.promise), star);
    await store.refreshProjectStar();
    const give = store.giveProjectStar();
    store.cancelProjectStar();
    pending.resolve(false);
    await give;
    expect(star).not.toHaveBeenCalled();
  });
  test("workspace switch during PUT retry delay aborts before another star request", async () => {
    const waiting = deferred<void>();
    let puts = 0;
    const retryClient = client(
      async (url, options) => {
        const request =
          url instanceof Request ? new Request(url, options) : new Request(String(url), options);
        if (request.method === "PUT") puts++;
        return new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "900" },
        });
      },
      undefined,
      {
        maxRateLimitRetries: 2,
        sleep: async () => {
          waiting.resolve();
          return new Promise<void>(() => {});
        },
      },
    );
    const { store } = await makeStore(
      async () => false,
      (signal) => retryClient.starProject(signal),
    );
    await store.refreshProjectStar();
    const give = store.giveProjectStar();
    await waiting.promise;

    const next = workspaceFixture();
    fixtures.push(next);
    await next.save();
    await store.switchWorkspace(next.root);
    await give;
    expect(puts).toBe(1);
  });
  test("workspace change ignores an old pending result and disposal aborts the current request", async () => {
    const pending = deferred<boolean>(),
      signals: AbortSignal[] = [];
    const { store } = await makeStore(async (signal) => {
      if (signal) signals.push(signal);
      return pending.promise;
    });
    const check = store.refreshProjectStar();
    const second = workspaceFixture();
    fixtures.push(second);
    await second.save();
    await store.switchWorkspace(second.root);
    pending.resolve(true);
    await check;
    expect(signals[0]?.aborted).toBe(true);
    expect(store.getSnapshot().projectStar.status).toBe("idle");
    const current = store.refreshProjectStar();
    store.dispose();
    await current;
    expect(signals[1]?.aborted).toBe(true);
  });
  test("modal input and menu Enter never trigger the star action", async () => {
    const star = mock(async () => {}),
      { store } = await makeStore(async () => false, star),
      setup = await render(store);
    try {
      await waitUntil(() => store.getSnapshot().projectStar.status === "available");
      store.openSearchModal();
      await setup.flush();
      await setup.mockInput.typeText("s");
      await setup.mockInput.pressEnter();
      expect(star).not.toHaveBeenCalled();
      store.closeModal();
      store.setNavFocused(true);
      await setup.flush();
      await setup.mockInput.pressEnter();
      expect(star).not.toHaveBeenCalled();
    } finally {
      await setup.dispose();
    }
  });
});
