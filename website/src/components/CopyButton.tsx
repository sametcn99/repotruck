import { useEffect, useRef, useState } from "react";

function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => copyViaTextarea(text),
    );
  }
  return Promise.resolve(copyViaTextarea(text));
}

function copyViaTextarea(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  document.body.removeChild(textarea);
  return copied;
}

export function CopyButton({ command }: { command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const onClick = (): void => {
    void copyToClipboard(command).then((copied) => {
      setState(copied ? "copied" : "failed");
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => setState("idle"), 2000);
    });
  };

  return (
    <button
      type="button"
      className={`copy-button${state === "copied" ? " copied" : ""}`}
      aria-label={`Copy command: ${command}`}
      onClick={onClick}
    >
      {state === "copied" ? "Copied!" : state === "failed" ? "Select & copy" : "Copy"}
    </button>
  );
}
