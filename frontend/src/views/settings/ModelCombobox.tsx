import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ModelComboboxProps {
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

const LABEL = "text-sm font-medium text-foreground";

/**
 * Editable model picker: a text input (any model slug is allowed) plus a
 * toggle that reveals the suggested list. Unlike a native `<datalist>`, the
 * list always opens on click — even when the field already holds a complete
 * value — and expands inline, so a card with hidden overflow can't clip it.
 */
export function ModelCombobox(props: ModelComboboxProps): ReactNode {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const id = useId();

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
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={id} className={LABEL}>
          {props.label}
        </label>
        <Input
          id={id}
          className="font-mono"
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
    <div className="flex min-w-0 flex-col gap-1.5" ref={wrapRef}>
      <label htmlFor={id} className={LABEL}>
        {props.label}
      </label>
      <div className="relative">
        <Input
          id={id}
          className={cn("font-mono", hasOptions && "pr-9")}
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
            className="absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`Show ${props.label} options`}
            aria-expanded={open}
            tabIndex={-1}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                open && "rotate-180",
              )}
              aria-hidden="true"
            />
          </button>
        )}
      </div>
      {open && visible.length > 0 && (
        <ul className="flex max-h-52 flex-col overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xs">
          {visible.map((option) => {
            const active = option === props.value;
            return (
              <li key={option}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-xs text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    active && "bg-accent text-foreground",
                  )}
                  onClick={() => {
                    props.onChange(option);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{option}</span>
                  {active && (
                    <Check className="size-3.5 shrink-0" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
