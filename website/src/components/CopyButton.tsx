import { useCopy } from "../hooks.ts";

export function CopyButton({ command }: { command: string }) {
  const { state, copy } = useCopy(command);

  return (
    <button
      type="button"
      className={`copy-button${state === "copied" ? " copied" : ""}`}
      aria-label={`Copy command: ${command}`}
      onClick={copy}
    >
      {state === "copied" ? "Copied!" : state === "failed" ? "Select & copy" : "Copy"}
    </button>
  );
}
