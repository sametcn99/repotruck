import { useCallback, useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

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

export function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => copyViaTextarea(text),
    );
  }
  return Promise.resolve(copyViaTextarea(text));
}

/** Copy-on-click state for one-shot copy affordances (chip, button, ...). */
export function useCopy(text: string): { state: CopyState; copy: () => void } {
  const [state, setState] = useState<CopyState>("idle");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copy = useCallback((): void => {
    void copyToClipboard(text).then((copied) => {
      setState(copied ? "copied" : "failed");
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => setState("idle"), 2000);
    });
  }, [text]);

  return { state, copy };
}
