import { parse } from "yaml";

type Workflow = {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<
    string,
    {
      needs?: string | string[];
      uses?: string;
      steps?: Array<{ uses?: string; run?: string; env?: Record<string, string>; if?: string }>;
    }
  >;
};
export function checkWorkflowPolicy(ciSource: string, releaseSource: string): string[] {
  const ci = parse(ciSource) as Workflow,
    release = parse(releaseSource) as Workflow,
    errors: string[] = [];
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
