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

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || window.matchMedia === undefined) {
      return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia === undefined) {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);

  return reduced;
}

export function useTypewriter(text: string, msPerChar = 40): { typed: string; done: boolean } {
  const reduced = useReducedMotion();
  const [count, setCount] = useState<number>(reduced ? text.length : 0);

  useEffect(() => {
    if (reduced) {
      setCount(text.length);
      return;
    }
    setCount(0);
    if (text.length === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setCount((current) => {
        if (current >= text.length) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, msPerChar);
    return () => {
      window.clearInterval(timer);
    };
  }, [text, msPerChar, reduced]);

  return { typed: text.slice(0, count), done: count >= text.length };
}
