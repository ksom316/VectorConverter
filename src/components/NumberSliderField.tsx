import { useId, useRef, useState } from "react";

interface NumberSliderFieldProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * One numeric setting with three ways to change it - drag the slider, click -/+, or type an exact
 * number - that all go through the same onChange.
 *
 * While the user types, the text is kept in a local draft instead of being clamped and written
 * back on every keystroke, so a partial entry such as the "1" of "176" is never replaced under
 * their fingers. A value that is already valid is applied immediately; anything else is clamped
 * (or reverted if empty) when the field loses focus or Enter is pressed. Escape cancels the edit
 * and restores the value the field had when editing began.
 */
export function NumberSliderField({ label, hint, value, min, max, step, onChange, disabled }: NumberSliderFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const valueWhenFocused = useRef(value);

  const apply = (next: number) => onChange(clamp(Math.round(next / step) * step, min, max));
  const draftNumber = draft !== null && draft !== "" ? Number(draft) : null;
  const draftOutOfRange = draftNumber !== null && (draftNumber < min || draftNumber > max);

  const commitDraft = () => {
    if (draft !== null && draft !== "") apply(Number(draft));
    setDraft(null);
  };

  const buttonClass =
    "flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-sm text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${id}-number`} className="text-xs font-medium text-slate-300">
          {label}
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={buttonClass}
            aria-label={`Decrease ${label}`}
            disabled={disabled || value <= min}
            onClick={() => apply(value - step)}
          >
            −
          </button>
          <input
            id={`${id}-number`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            value={draft ?? String(value)}
            aria-invalid={draftOutOfRange || undefined}
            aria-describedby={hint ? `${id}-hint` : undefined}
            title={`${min}–${max}`}
            onChange={(e) => {
              const text = e.target.value;
              if (!/^\d{0,4}$/.test(text)) return; // digits only; ignore anything else
              setDraft(text);
              if (text !== "" && Number(text) >= min && Number(text) <= max) onChange(Number(text));
            }}
            onBlur={commitDraft}
            onFocus={(e) => {
              valueWhenFocused.current = value;
              e.currentTarget.select();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitDraft();
              } else if (e.key === "Escape") {
                setDraft(null);
                if (value !== valueWhenFocused.current) onChange(valueWhenFocused.current);
              } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                const delta = (e.shiftKey ? 10 : 1) * step * (e.key === "ArrowUp" ? 1 : -1);
                setDraft(null);
                apply(value + delta);
              }
            }}
            className={`h-7 w-14 rounded-md border bg-slate-900 px-1.5 text-center text-xs tabular-nums text-slate-100 focus:outline-none focus:ring-1 disabled:opacity-40 ${
              draftOutOfRange
                ? "border-amber-500 focus:ring-amber-500"
                : "border-slate-700 focus:border-indigo-500 focus:ring-indigo-500"
            }`}
          />
          <button
            type="button"
            className={buttonClass}
            aria-label={`Increase ${label}`}
            disabled={disabled || value >= max}
            onClick={() => apply(value + step)}
          >
            +
          </button>
        </div>
      </div>
      <input
        type="range"
        aria-label={`${label} slider`}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => apply(Number(e.target.value))}
        className="w-full accent-indigo-500 disabled:opacity-40"
      />
      {draftOutOfRange ? (
        <span className="text-[11px] text-amber-300">
          Enter a value from {min} to {max}.
        </span>
      ) : (
        hint && (
          <span id={`${id}-hint`} className="text-[11px] leading-snug text-slate-500">
            {hint}
          </span>
        )
      )}
    </div>
  );
}
