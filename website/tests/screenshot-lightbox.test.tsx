import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Screenshots } from "../src/components/Screenshots.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

function openShot(slug: string): HTMLDialogElement {
  const trigger = document.querySelector(`#shot-${slug} .screenshot-open`);
  if (!trigger) throw new Error(`missing gallery trigger for ${slug}`);
  fireEvent.click(trigger);
  return document.querySelector("dialog.lightbox") as HTMLDialogElement;
}

suite("screenshot lightbox", () => {
  test("clicking a gallery frame opens the enlarged viewer", () => {
    render(<Screenshots />);
    const dialog = openShot("cockpit");

    expect(dialog.open).toBe(true);
    const enlarged = dialog.querySelector(".lightbox-stage img") as HTMLImageElement;
    expect(enlarged.getAttribute("src")).toBe("/screenshots/cockpit.svg");
    expect(enlarged.getAttribute("alt")).toContain("Cockpit");
    expect(dialog.getAttribute("aria-label")).toContain("enlarged screenshot");
  });

  test("close button closes the viewer", () => {
    render(<Screenshots />);
    const dialog = openShot("cockpit");

    fireEvent.click(screen.getByRole("button", { name: "Close screenshot viewer" }));
    expect(dialog.open).toBe(false);
  });

  test("tapping the letterbox around the image closes the viewer", () => {
    render(<Screenshots />);
    const dialog = openShot("help");
    const stage = dialog.querySelector(".lightbox-stage") as HTMLDivElement;

    // jsdom gives the img a 0x0 rect, so any tap on the stage lands outside it.
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(dialog.open).toBe(false);
  });

  test("zoom buttons update the readout, transform and reset", () => {
    render(<Screenshots />);
    const dialog = openShot("cockpit");
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("135%")).toBeInTheDocument();
    const img = dialog.querySelector(".lightbox-stage img") as HTMLImageElement;
    expect(img.style.transform).toContain("scale(1.35)");

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(img.style.transform).toContain("scale(1)");
  });

  test("mouse wheel over the stage zooms in and clamps back to 100%", () => {
    render(<Screenshots />);
    const dialog = openShot("cockpit");
    const stage = dialog.querySelector(".lightbox-stage") as HTMLDivElement;

    fireEvent.wheel(stage, { deltaY: -240, clientX: 500, clientY: 400 });
    expect(screen.getByText("170%")).toBeInTheDocument(); // exp(240 * 0.0022)

    fireEvent.wheel(stage, { deltaY: 400, clientX: 500, clientY: 400 });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  test("keyboard + and 0 control zoom", () => {
    render(<Screenshots />);
    const dialog = openShot("cockpit");

    fireEvent.keyDown(dialog, { key: "+" });
    expect(screen.getByText("135%")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "0" });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
