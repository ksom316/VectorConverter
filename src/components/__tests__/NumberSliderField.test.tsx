import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumberSliderField } from "../NumberSliderField";

/** A controlled harness: the field is driven by real state, like in the app. */
function Harness({ initial = 50, min = 0, max = 255, onChange = () => {} }: { initial?: number; min?: number; max?: number; onChange?: (v: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <NumberSliderField
      label="Threshold"
      hint="Explains the setting."
      value={value}
      min={min}
      max={max}
      step={1}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

const numberInput = () => screen.getByLabelText("Threshold") as HTMLInputElement;
const slider = () => screen.getByLabelText("Threshold slider") as HTMLInputElement;

describe("NumberSliderField", () => {
  it("shows a clear label, the explanation, and the value in both the field and the slider", () => {
    render(<Harness initial={128} />);
    expect(numberInput()).toHaveValue("128");
    expect(slider()).toHaveValue("128");
    expect(screen.getByText("Explains the setting.")).toBeInTheDocument();
  });

  it("lets the user type a multi-digit value without replacing partial input", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={50} onChange={onChange} />);
    await user.click(numberInput());
    await user.keyboard("176");
    expect(numberInput()).toHaveValue("176");
    expect(slider()).toHaveValue("176");
    expect(onChange).toHaveBeenLastCalledWith(176);
  });

  it("does not clamp a partial entry while typing (a minimum above the first digit does not fight the user)", async () => {
    const user = userEvent.setup();
    render(<Harness initial={50} min={10} max={255} />);
    await user.click(numberInput());
    await user.keyboard("2");
    expect(numberInput()).toHaveValue("2"); // below the minimum, but left alone while typing
    await user.keyboard("00");
    expect(numberInput()).toHaveValue("200");
    expect(slider()).toHaveValue("200");
  });

  it("holds an out-of-range entry while typing, warns, then clamps it when the field loses focus", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={50} onChange={onChange} />);
    await user.click(numberInput());
    await user.keyboard("999");
    expect(numberInput()).toHaveValue("999");
    expect(numberInput()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a value from 0 to 255.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith(999);
    expect(slider()).toHaveValue("99"); // the last valid partial entry ("99") stays applied, never 999

    await user.tab();
    expect(numberInput()).toHaveValue("255");
    expect(slider()).toHaveValue("255");
    expect(onChange).toHaveBeenLastCalledWith(255);
  });

  it("reverts an empty field on blur, and Escape cancels the edit back to the value it started from", async () => {
    const user = userEvent.setup();
    render(<Harness initial={77} />);
    await user.click(numberInput());
    await user.keyboard("{Backspace}{Backspace}");
    expect(numberInput()).toHaveValue("");
    await user.tab();
    expect(numberInput()).toHaveValue("77");

    await user.click(numberInput());
    await user.keyboard("12{Escape}");
    expect(numberInput()).toHaveValue("77");
  });

  it("ignores characters that are not digits", async () => {
    const user = userEvent.setup();
    render(<Harness initial={5} />);
    await user.click(numberInput());
    await user.keyboard("a-.");
    expect(numberInput()).toHaveValue("5");
  });

  it("applies Enter like blur", async () => {
    const user = userEvent.setup();
    render(<Harness initial={5} max={10} />);
    await user.click(numberInput());
    await user.keyboard("40{Enter}");
    expect(numberInput()).toHaveValue("10");
  });

  it("steps with the plus and minus buttons and disables them at the limits", async () => {
    const user = userEvent.setup();
    render(<Harness initial={1} min={0} max={2} />);
    await user.click(screen.getByLabelText("Increase Threshold"));
    expect(numberInput()).toHaveValue("2");
    expect(screen.getByLabelText("Increase Threshold")).toBeDisabled();
    await user.click(screen.getByLabelText("Decrease Threshold"));
    await user.click(screen.getByLabelText("Decrease Threshold"));
    expect(numberInput()).toHaveValue("0");
    expect(screen.getByLabelText("Decrease Threshold")).toBeDisabled();
  });

  it("follows the slider, and keeps the number field and slider in step with each other", () => {
    render(<Harness initial={10} />);
    fireEvent.change(slider(), { target: { value: "99" } });
    expect(numberInput()).toHaveValue("99");
    expect(slider()).toHaveValue("99");
  });

  it("steps with the arrow keys, ten at a time with Shift, within the range", async () => {
    const user = userEvent.setup();
    render(<Harness initial={5} max={20} />);
    await user.click(numberInput());
    await user.keyboard("{ArrowUp}");
    expect(numberInput()).toHaveValue("6");
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(numberInput()).toHaveValue("16");
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(numberInput()).toHaveValue("20");
    await user.keyboard("{ArrowDown}");
    expect(numberInput()).toHaveValue("19");
  });

  it("can be disabled as a whole", () => {
    render(<NumberSliderField label="Threshold" value={5} min={0} max={10} step={1} onChange={() => {}} disabled />);
    expect(numberInput()).toBeDisabled();
    expect(slider()).toBeDisabled();
    expect(screen.getByLabelText("Increase Threshold")).toBeDisabled();
    expect(screen.getByLabelText("Decrease Threshold")).toBeDisabled();
  });
});
