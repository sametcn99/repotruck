import { parse } from "yaml";

type Workflow = {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<
    string,
    {
      needs?: string | string[];
      uses?: string;
      strategy?: { matrix?: Record<string, unknown> };
      steps?: WorkflowStep[];
    }
  >;
};

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  if?: string;
  with?: Record<string, string>;
};

export function checkMinimumTuiPolicy(ciSource: string): string[] {
  const ci = parse(ciSource) as Workflow;
  const job = ci.jobs?.["minimum-tui"];
  const errors: string[] = [];
  if (!job) return ["minimum-tui job must exist"];

  const runtimes = job.strategy?.matrix?.runtime;
  if (!Array.isArray(runtimes) || runtimes.join(",") !== "bun,node")
    errors.push("minimum-tui must keep the bun/node runtime matrix");

  const steps = job.steps ?? [];
  const indexOf = (predicate: (step: WorkflowStep) => boolean) => steps.findIndex(predicate);
  const setupLockCompatibleBun = indexOf((step) =>
    Boolean(step.uses?.startsWith("oven-sh/setup-bun@") && step.with?.["bun-version"] === "1.4.2"),
  );
  const install = indexOf((step) => step.run === "bun install --frozen-lockfile");
  const build = indexOf((step) => step.run === "bun run build");
  const setupMinimumBun = indexOf((step) =>
    Boolean(step.uses?.startsWith("oven-sh/setup-bun@") && step.with?.["bun-version"] === "1.3.14"),
  );
  const e62 = indexOf((step) => step.run === "bun test tests/hardening-processes.test.ts -t E62");
  if (setupLockCompatibleBun < 0 || setupLockCompatibleBun > install)
    errors.push("minimum-tui must select Bun 1.4.2 before dependency installation");
  if (install < 0 || install > build)
    errors.push("minimum-tui must frozen-install dependencies before building");
  if (build < 0 || setupMinimumBun < 0 || setupMinimumBun < build || setupMinimumBun > e62)
    errors.push("minimum-tui must select Bun 1.3.14 after build and before E62");
  if (steps[setupMinimumBun]?.if !== "matrix.runtime == 'bun'")
    errors.push("minimum-tui Bun 1.3.14 setup must apply only to the Bun runtime case");
  if (e62 < 0 || e62 < build)
    errors.push("minimum-tui must run E62 after building the distribution entry");

  const setupNode = steps.find(
    (step) =>
      step.uses?.startsWith("actions/setup-node@") && step.with?.["node-version"] === "26.4.0",
  );
  if (!setupNode) errors.push("minimum-tui must retain the Node 26.4.0 runtime");
  if (
    !steps.some(
      (step) =>
        step.if === "matrix.runtime == 'bun'" && step.run === 'test "$(bun --version)" = "1.3.14"',
    )
  )
    errors.push("minimum-tui must assert Bun 1.3.14 before its runtime test");
  if (
    !steps.some(
      (step) =>
        step.if === "matrix.runtime == 'node'" &&
        step.run === 'test "$(node --version)" = "v26.4.0"',
    )
  )
    errors.push("minimum-tui must assert Node 26.4.0 before its runtime test");

  const e62Step = steps[e62];
  const runtimeExpression = "$" + "{{ matrix.runtime }}";
  const expectedVersionExpression = "$" + "{{ matrix.runtime == 'bun' && '1.3.14' || 'v26.4.0' }}";
  const nodeFlagsExpression = "$" + "{{ matrix.runtime == 'node' && '--experimental-ffi' || '' }}";
  if (e62Step?.env?.REPOTRUCK_TUI_TEST_RUNTIME !== runtimeExpression)
    errors.push("minimum-tui E62 must execute the selected runtime binary");
  if (e62Step?.env?.REPOTRUCK_TUI_TEST_EXPECTED_VERSION !== expectedVersionExpression)
    errors.push("minimum-tui E62 must pass the selected runtime version assertion");
  if (e62Step?.env?.REPOTRUCK_TUI_TEST_FLAGS !== nodeFlagsExpression)
    errors.push("minimum-tui Node E62 must keep --experimental-ffi enabled");
  return errors;
}

export function checkWorkflowPolicy(ciSource: string, releaseSource: string): string[] {
  const ci = parse(ciSource) as Workflow,
    release = parse(releaseSource) as Workflow,
    errors: string[] = checkMinimumTuiPolicy(ciSource);
  if (!ci.on || !("workflow_call" in ci.on) || !("pull_request" in ci.on))
    errors.push("CI must be reusable and run on pull requests");
  if (release.jobs?.ci?.uses !== "./.github/workflows/ci.yml")
    errors.push("release must call the shared CI workflow");
  const publish = release.jobs?.publish,
    needs = typeof publish?.needs === "string" ? [publish.needs] : (publish?.needs ?? []);
  if (!needs.includes("ci")) errors.push("publish must depend on CI");
  const publishSteps = publish?.steps ?? [],
    publishStep = publishSteps.find((step) => step.run?.includes("npm publish"));
  if (!publishStep?.run?.includes("--provenance"))
    errors.push("npm publication must include provenance");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
  if (publishStep?.env?.NODE_AUTH_TOKEN !== "${{ secrets.NPM_TOKEN }}")
    errors.push("publish must use the configured scoped npm credential");
  for (const [name, workflow] of [
    ["CI", ci],
    ["release", release],
  ] as const) {
    for (const job of Object.values(workflow.jobs ?? {}))
      for (const step of job.steps ?? []) {
        if (step.uses && !step.uses.startsWith("./") && !/@[0-9a-f]{40}$/.test(step.uses))
          errors.push(`${name} action is not pinned: ${step.uses}`);
        if (
          name === "CI" &&
          Object.values(step.env ?? {}).some((value) => value.includes("secrets.NPM_TOKEN"))
        )
          errors.push("CI must not receive npm publication credentials");
      }
  }
  if (
    !Object.values(ci.jobs ?? {}).some((job) =>
      job.steps?.some(
        (step) => step.uses?.startsWith("actions/upload-artifact@") && step.if === "always()",
      ),
    )
  )
    errors.push("CI must retain evidence on failures");
  return errors;
}
