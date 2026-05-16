import type { ReactNode } from "react";

interface Option<T extends string> {
  value: T;
  icon?: string;
  label: string;
}

interface Props<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  ariaLabel?: string;
}

export function ModeToggle<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: Props<T>): ReactNode {
  return (
    <div className="mode-toggle" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={`mode-pill ${value === o.value ? "active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <span aria-hidden="true">{o.icon}</span>}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
