/** Async results belong to the request and workspace that started them. */
export class OperationTracker {
  private readonly requests = new Map<string, { root: string; controller: AbortController }>();
  constructor(private readonly currentRoot: () => string) {}

  has(key: string) {
    return this.requests.has(key);
  }

  start(key: string) {
    this.requests.get(key)?.controller.abort();
    const request = { root: this.currentRoot(), controller: new AbortController() };
    this.requests.set(key, request);
    return {
      root: request.root,
      signal: request.controller.signal,
      current: () => this.requests.get(key) === request && this.currentRoot() === request.root,
      finish: () => {
        if (this.requests.get(key) === request) this.requests.delete(key);
      },
    };
  }

  invalidate() {
    for (const request of this.requests.values()) request.controller.abort();
    this.requests.clear();
  }

  cancel(key: string) {
    this.requests.get(key)?.controller.abort();
    this.requests.delete(key);
  }
}
