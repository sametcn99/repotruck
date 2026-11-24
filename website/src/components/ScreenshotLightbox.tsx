import { useCallback, useEffect, useRef, useState } from "react";
import { trapDialogFocus } from "./dialogFocus.ts";
import type { ScreenshotEntry } from "./screenshotsManifest.generated.ts";

/**
 * Fullscreen viewer for a captured TUI frame.
 *
 * Native <dialog> (top layer, Esc to close, focus restored to the opener) with
 * direct-manipulation zoom/pan on top: mouse wheel and trackpad pinch zoom
 * anchored at the cursor, one-finger drag to pan, two-finger pinch on touch,
 * double-click/double-tap to toggle, and +/−/0 keyboard controls.
 */

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const STEP = 1.35; // zoom factor per button press / key press
const DBLCLICK_SCALE = 2.5;
const DRAG_SLOP = 6; // px of pointer travel before a gesture counts as a drag

interface Transform {
  scale: number;
  x: number;
  y: number;
}

const RESET: Transform = { scale: 1, x: 0, y: 0 };

interface Gesture {
  mode: "pan" | "pinch" | null;
  moved: boolean;
  startX: number;
  startY: number;
  startDist: number;
  startMidX: number;
  startMidY: number;
  startT: Transform;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function ScreenshotLightbox({
  shot,
  onClose,
}: {
  shot: ScreenshotEntry | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [t, setT] = useState<Transform>(RESET);
  const [dragging, setDragging] = useState(false);
  const tRef = useRef(t);
  tRef.current = t;
  const gesture = useRef<Gesture>({
    mode: null,
    moved: false,
    startX: 0,
    startY: 0,
    startDist: 1,
    startMidX: 0,
    startMidY: 0,
    startT: RESET,
  });
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // Keep the transform inside the stage: never zoom past the limits and never
  // pan past the image edges (offsetWidth/Height are the untransformed layout
  // sizes, so the pannable range grows exactly with the zoom).
  const clamp = useCallback((next: Transform): Transform => {
    const scale = clampScale(next.scale);
    if (scale === MIN_SCALE) return RESET;
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img) return { scale, x: next.x, y: next.y };
    const maxX = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2);
    return {
      scale,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, []);

  // Zoom by `factor` keeping the point (px, py) — cursor or pinch midpoint —
  // pinned to the same image content.
  const zoomAt = useCallback(
    (px: number, py: number, factor: number) => {
      setT((prev) => {
        const stage = stageRef.current;
        if (!stage) return prev;
        const scale = clampScale(prev.scale * factor);
        const applied = scale / prev.scale;
        if (applied === 1) return prev;
        const rect = stage.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = px - cx - prev.x;
        const dy = py - cy - prev.y;
        return clamp({
          scale,
          x: px - cx - dx * applied,
          y: py - cy - dy * applied,
        });
      });
    },
    [clamp],
  );

  const zoomCenter = useCallback(
    (factor: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt],
  );

  // Wheel must be a non-passive native listener to stop the page behind the
  // dialog from scrolling; React's onWheel is passive in the DOM plumbing.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !shot) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 33 : event.deltaY;
      zoomAt(event.clientX, event.clientY, Math.exp(-delta * 0.0022));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [shot, zoomAt]);

  // Open/close ride on the native dialog so Esc, focus trapping and focus
  // restoration come for free; reset the transform on every (re)open.
  const activeSlug = shot?.slug;
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg || !activeSlug) return;
    setT(RESET);
    pointers.current.clear();
    gesture.current.mode = null;
    if (!dlg.open) dlg.showModal();
  }, [activeSlug]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg && shot) return;
    if (dlg?.open && !shot) dlg.close();
  }, [shot]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      g.mode = "pinch";
      g.startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      g.startMidX = (a.x + b.x) / 2;
      g.startMidY = (a.y + b.y) / 2;
      g.startT = tRef.current;
      setDragging(false);
    } else if (pointers.current.size === 1) {
      g.mode = "pan";
      g.moved = false;
      g.startX = event.clientX;
      g.startY = event.clientY;
      g.startT = tRef.current;
      setDragging(tRef.current.scale > 1);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (g.mode === "pan" && pointers.current.size === 1) {
      if (Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > DRAG_SLOP) {
        g.moved = true;
      }
      setT(
        clamp({
          ...g.startT,
          x: g.startT.x + (event.clientX - g.startX),
          y: g.startT.y + (event.clientY - g.startY),
        }),
      );
    } else if (g.mode === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const stage = stageRef.current;
      if (!a || !b || !stage) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const scale = clampScale(g.startT.scale * (dist / g.startDist));
      const applied = scale / g.startT.scale;
      const rect = stage.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = g.startMidX - cx - g.startT.x;
      const dy = g.startMidY - cy - g.startT.y;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      setT(
        clamp({
          scale,
          x: midX - cx - dx * applied,
          y: midY - cy - dy * applied,
        }),
      );
    }
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 1 && (g.mode === "pinch" || g.mode === "pan")) {
      // A pinch released one finger: continue the gesture as a pan from the
      // finger that is still down.
      const rest = [...pointers.current.values()][0];
      if (rest) {
        g.mode = "pan";
        g.moved = true;
        g.startX = rest.x;
        g.startY = rest.y;
        g.startT = tRef.current;
        setDragging(tRef.current.scale > 1);
      }
      return;
    }
    if (pointers.current.size === 0 && g.mode === "pan" && !g.moved) {
      // A tap (or click) on the letterbox around the image closes the viewer;
      // a real drag never does.
      const rect = imgRef.current?.getBoundingClientRect();
      const inside =
        rect &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) dialogRef.current?.close();
    }
    if (pointers.current.size === 0) {
      g.mode = null;
      setDragging(false);
    }
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (tRef.current.scale > 1.01) setT(RESET);
    else zoomAt(event.clientX, event.clientY, DBLCLICK_SCALE);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    trapDialogFocus(event);
    if (event.key === "+" || event.key === "=") zoomCenter(STEP);
    else if (event.key === "-" || event.key === "_") zoomCenter(1 / STEP);
    else if (event.key === "0") setT(RESET);
  };

  return (
    <dialog
      ref={dialogRef}
      className="lightbox"
      aria-label={shot ? `${shot.title} — enlarged screenshot` : "Screenshot viewer"}
      onClose={onClose}
      onKeyDown={onKeyDown}
    >
      {shot && (
        <>
          <button
            type="button"
            className="lightbox-close"
            aria-label="Close screenshot viewer"
            onClick={() => dialogRef.current?.close()}
          >
            ✕
          </button>
          <div
            ref={stageRef}
            className={`lightbox-stage${t.scale > 1 ? " is-pannable" : ""}${dragging ? " is-dragging" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onDoubleClick={onDoubleClick}
          >
            <img
              ref={imgRef}
              src={`${import.meta.env.BASE_URL}screenshots/${shot.slug}.svg`}
              alt={`${shot.title} — ${shot.caption}`}
              draggable={false}
              style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})` }}
            />
          </div>
          <div className="lightbox-bar">
            <p className="lightbox-caption">
              <strong>{shot.title}</strong>
              <span> — {shot.caption}</span>
            </p>
            <div className="lightbox-controls">
              <button type="button" aria-label="Zoom out" onClick={() => zoomCenter(1 / STEP)}>
                −
              </button>
              <span className="lightbox-zoom" aria-live="polite">
                {Math.round(t.scale * 100)}%
              </span>
              <button type="button" aria-label="Zoom in" onClick={() => zoomCenter(STEP)}>
                +
              </button>
              <button
                type="button"
                aria-label="Reset zoom"
                aria-disabled={t.scale === 1}
                onClick={() => setT(RESET)}
              >
                1:1
              </button>
            </div>
            <span className="lightbox-hint">
              <span className="hint-fine">
                scroll to zoom · drag to pan · double-click to reset
              </span>
              <span className="hint-coarse">pinch to zoom · drag to pan · double-tap to reset</span>
            </span>
          </div>
        </>
      )}
    </dialog>
  );
}
