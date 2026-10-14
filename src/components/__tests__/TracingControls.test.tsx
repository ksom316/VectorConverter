import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TracingControls } from "../TracingControls";
import { DEFAULT_TRACING_SETTINGS, type TracingSettings } from "../../lib/types";

function Harness({ onSettings, isTracing = false, pathCount = null, onRetrace = () => {} }: { onSettings?: (s: TracingSettings) => void; isTracing?: boolean; pathCount?: number | null; onRetrace?: () => void }) {
  const [settings, setSettings] = useState(DEFAULT_TRACING_SETTINGS);
  return (
    <TracingControls
      settings={settings}
      onChange={(next) => {
        setSettings(next);
        onSettings?.(next);
      }}
      onRetrace={onRetrace}
      isTracing={isTracing}
      pathCount={pathCount}
    />
  );
}

const numberField = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const slider = (label: string) => screen.getByLabelText(`${label} slider`) as HTMLInputElement;

const NUMERIC = [
  { label: "Black/white threshold", key: "threshold", start: 128, max: 255 },
  { label: "Noise reduction", key: "noiseReduction", start: 1, max: 10 },
  { label: "Smoothing", key: "smoothing", start: 4, max: 10 },
  { label: "Detail preservation", key: "detail", start: 6, max: 10 },
] as const;

describe("TracingControls", () => {
  it("offers all four numeric settings, each with a slider, minus, plus and a typed field starting at the app defaults", () => {
    render(<Harness />);
    for (const { label, start } of NUMERIC) {
      expect(numberField(label)).toHaveValue(String(start));
      expect(slider(label)).toHaveValue(String(start));
      expect(screen.getByLabelText(`Decrease ${label}`)).toBeInTheDocument();
      expect(screen.getByLabelText(`Increase ${label}`)).toBeInTheDocument();
    }
  });

  it("sends slider, plus/minus and typed changes through the same onChange, updating the same setting", async () => {
    const user = userEvent.setup();
    for (const { label, key, start, max } of NUMERIC) {
      const onSettings = vi.fn();
      const { unmount } = render(<Harness onSettings={onSettings} />);

      fireEvent.change(slider(label), { target: { value: String(start - 1) } });
      expect(onSettings).toHaveBeenLastCalledWith({ ...DEFAULT_TRACING_SETTINGS, [key]: start - 1 });

      await user.click(screen.getByLabelText(`Increase ${label}`));
      expect(onSettings).toHaveBeenLastCalledWith({ ...DEFAULT_TRACING_SETTINGS, [key]: start });

      await user.click(screen.getByLabelText(`Decrease ${label}`));
      expect(onSettings).toHaveBeenLastCalledWith({ ...DEFAULT_TRACING_SETTINGS, [key]: start - 1 });

      await user.click(numberField(label));
      await user.keyboard(String(max));
      expect(onSettings).toHaveBeenLastCalledWith({ ...DEFAULT_TRACING_SETTINGS, [key]: max });
      expect(slider(label)).toHaveValue(String(max));
      unmount();
    }
  });

  it("leaves every other setting untouched when one changes", async () => {
    const user = userEvent.setup();
    const onSettings = vi.fn();
    render(<Harness onSettings={onSettings} />);
    await user.click(screen.getByLabelText("Increase Smoothing"));
    expect(onSettings).toHaveBeenLastCalledWith({ ...DEFAULT_TRACING_SETTINGS, smoothing: DEFAULT_TRACING_SETTINGS.smoothing + 1 });
  });

  it("restores the actual application defaults with Reset to defaults, which is only enabled after a change", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const reset = screen.getByRole("button", { name: "Reset to defaults" });
    expect(reset).toBeDisabled();

    await user.click(screen.getByLabelText("Increase Smoothing"));
    await user.click(screen.getByLabelText("Increase Black/white threshold"));
    await user.click(screen.getByRole("checkbox", { name: /Auto threshold/ }));
    expect(reset).toBeEnabled();

    await user.click(reset);
    for (const { label, start } of NUMERIC) expect(numberField(label)).toHaveValue(String(start));
    expect(screen.getByRole("checkbox", { name: /Auto threshold/ })).not.toBeChecked();
    expect(reset).toBeDisabled();
  });

  it("disables the threshold controls while Auto threshold is on, and leaves the others usable", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: /Auto threshold/ }));
    expect(numberField("Black/white threshold")).toBeDisabled();
    expect(slider("Black/white threshold")).toBeDisabled();
    expect(screen.getByLabelText("Increase Black/white threshold")).toBeDisabled();
    expect(numberField("Smoothing")).toBeEnabled();
  });

  it("shows what is happening: updating while tracing, the path count when done, and a hint when nothing was traced", () => {
    const { rerender } = render(<Harness isTracing />);
    expect(screen.getByRole("status")).toHaveTextContent("Updating preview…");

    rerender(<Harness pathCount={12} />);
    expect(screen.getByRole("status")).toHaveTextContent("Preview is up to date · 12 paths traced");

    rerender(<Harness pathCount={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 path traced");

    rerender(<Harness pathCount={0} />);
    expect(screen.getByRole("status")).toHaveTextContent(/No paths were found/);
  });

  it("keeps an explicit Retrace now action", async () => {
    const user = userEvent.setup();
    const onRetrace = vi.fn();
    render(<Harness onRetrace={onRetrace} />);
    await user.click(screen.getByRole("button", { name: "Retrace now" }));
    expect(onRetrace).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Generate vector/ })).toBeNull();
  });
});
