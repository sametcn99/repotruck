import { GitHubService } from "../../src/services/github.ts";

export const PUBLIC_ID = "a".repeat(32);
export const SECRET_ID = "b".repeat(32);
export const EXTERNAL_ID = "c".repeat(32);
export const CREATED_ID = "d".repeat(32);

export function gistPayload(id: string, options: { public?: boolean; owner?: string } = {}) {
  return {
    id,
    owner: { login: options.owner ?? "acme" },
    public: options.public === true,
    description: options.public ? "Public notes" : "Secret notes",
    updated_at: "2026-01-01T00:00:00Z",
    files: { "notes.txt": { content: "first line\nsecond line\n" } } as Record<
      string,
      {
        content: string;
        truncated?: boolean;
      }
    >,
    history: [{ version: "initial" }],
  };
}

export function gistApiFixture(
  initial = [gistPayload(PUBLIC_ID, { public: true }), gistPayload(SECRET_ID)],
) {
  const items = new Map(initial.map((gist) => [gist.id, gist]));
  const requests: {
    method: string;
    route: string;
    body: Record<string, unknown>;
    page: string | null;
  }[] = [];
  const response = (data: unknown, status = 200) => Response.json(data, { status });
  const github = new GitHubService("fixture-token", {
    retry: { maxRateLimitRetries: 0, maxNetworkRetries: 0 },
    request: {
      fetch: async (input: string | Request | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const route = url.pathname;
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        requests.push({ method, route, body, page: url.searchParams.get("page") });
        if (route === "/user") return response({ login: "acme" });
        if (
          route === "/user/repos" ||
          route === "/user/memberships/orgs" ||
          route.startsWith("/orgs/")
        )
          return response([]);
        if (route === "/gists" && method === "GET") {
          const page = Number(url.searchParams.get("page") ?? 1);
          return response([...items.values()].slice((page - 1) * 100, page * 100));
        }
        if (route === "/gists" && method === "POST") {
          const gist = {
            ...gistPayload(CREATED_ID, { public: body.public === true }),
            description: body.description ?? "",
            files: body.files,
          };
          items.set(CREATED_ID, gist);
          return response(gist, 201);
        }
        const id = route.split("/").at(-1) ?? "";
        const gist = items.get(id);
        if (!gist) return response({ message: "Not found" }, 404);
        if (method === "DELETE") {
          items.delete(id);
          return new Response(null, { status: 204 });
        }
        if (method === "PATCH") {
          gist.description = body.description ?? gist.description;
          for (const [name, patch] of Object.entries(body.files ?? {}) as [
            string,
            { filename?: string; content?: string } | null,
          ][]) {
            const previous = gist.files[name];
            delete gist.files[name];
            if (patch)
              gist.files[patch.filename ?? name] = {
                content: patch.content ?? previous?.content ?? "",
              };
          }
          gist.history = [{ version: "edited" }];
        }
        return response(gist);
      },
    },
  });
  return { github, items, requests };
}
