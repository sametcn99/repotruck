import { StoreCore } from "./StoreCore.ts";

export class StoreAbout extends StoreCore {
  cancelProjectStar = (): void => this.operations.cancel("project-star");

  refreshProjectStar = async (): Promise<void> => {
    if (this.operations.has("project-star")) return;
    const github = this.github;
    if (this.state.offline || this.state.phase !== "ready" || github === null) {
      this.set({
        projectStar: {
          status: "unavailable",
          message: "Sign in to GitHub and go online to give a star.",
        },
      });
      return;
    }
    if (!github.isProjectStarred || !github.starProject) {
      this.set({
        projectStar: {
          status: "unavailable",
          message: "Give star is unavailable for this session.",
        },
      });
      return;
    }
    const operation = this.workspaceOperation("project-star");
    operation.set({ projectStar: { status: "checking", message: null } });
    try {
      const starred = await github.isProjectStarred(operation.signal);
      if (this.github !== github) return;
      operation.set({ projectStar: { status: starred ? "starred" : "available", message: null } });
    } catch (error) {
      if (this.github !== github) return;
      operation.set({
        projectStar: {
          status: "error",
          message: error instanceof Error ? error.message : "GitHub star check failed. Retry.",
        },
      });
    } finally {
      operation.finish();
    }
  };

  giveProjectStar = async (): Promise<void> => {
    if (this.state.projectStar.status !== "available" || this.operations.has("project-star"))
      return;
    const github = this.github;
    if (this.state.offline || !github?.isProjectStarred || !github.starProject) return;
    const operation = this.workspaceOperation("project-star");
    operation.set({ projectStar: { status: "submitting", message: null } });
    try {
      // An external star between opening About and clicking needs no second write.
      if (!(await github.isProjectStarred(operation.signal))) {
        if (!operation.current() || this.github !== github) return;
        await github.starProject(operation.signal);
        if (!operation.current() || this.github !== github) return;
        if (!(await github.isProjectStarred(operation.signal))) {
          throw new Error("GitHub has not confirmed the star yet. Retry the status check.");
        }
      }
      if (this.github !== github) return;
      operation.set({ projectStar: { status: "starred", message: null } });
    } catch (error) {
      if (this.github !== github) return;
      operation.set({
        projectStar: {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "GitHub star request failed. Retry the status check.",
        },
      });
    } finally {
      operation.finish();
    }
  };
}
