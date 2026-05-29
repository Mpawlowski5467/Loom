import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface ModelComboboxProps {
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * Editable model picker: a text input (any model slug is allowed) plus a
 * toggle that reveals the suggested list. Unlike a native `<datalist>`, the
 * list always opens on click — even when the field already holds a complete
 * value — and expands inline (the provider card uses `overflow: hidden`, which
 * would clip an absolutely-positioned dropdown).
 */
export function ModelCombobox(props: ModelComboboxProps): ReactNode {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (props.disabled) {
    return (
      <div className="settings-field">
        <span className="settings-field-label">{props.label}</span>
        <input
          className="input mono"
          type="text"
          value=""
          placeholder="Unavailable"
          disabled
        />
      </div>
    );
  }

  // Filter while typing, but show the whole list when the field is empty or
  // already holds a complete option — so the toggle always reveals choices.
  const query = props.value.trim().toLowerCase();
  const isComplete = props.options.some((o) => o.toLowerCase() === query);
  const visible =
    query && !isComplete
      ? props.options.filter((o) => o.toLowerCase().includes(query))
      : props.options;
  const hasOptions = props.options.length > 0;

  return (
    <div className="settings-field" ref={wrapRef}>
      <span className="settings-field-label">{props.label}</span>
      <div className="model-combobox">
        <div className="model-combobox-control">
          <input
            className="input mono"
            type="text"
            value={props.value}
            placeholder="model name"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              props.onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => hasOptions && setOpen(true)}
            onClick={() => hasOptions && setOpen(true)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          />
          {hasOptions && (
            <button
              type="button"
              className="model-combobox-toggle"
              aria-label={`Show ${props.label} options`}
              aria-expanded={open}
              tabIndex={-1}
              onClick={() => setOpen((v) => !v)}
            >
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        {open && visible.length > 0 && (
          <ul className="model-combobox-list">
            {visible.map((option) => (
              <li key={option}>
                <button
                  type="button"
                  className={
                    "model-combobox-option" +
                    (option === props.value ? " is-active" : "")
                  }
                  onClick={() => {
                    props.onChange(option);
                    setOpen(false);
                  }}
                >
                  {option}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
