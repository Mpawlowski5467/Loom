import { useState } from "react";
import type { ReactNode } from "react";
import { PROMPT_TEMPLATES, type PromptTemplate } from "./promptTemplates";

interface PromptFieldProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

/**
 * Instructions editor: starter-template chips above a large textarea with a
 * live character count. Inserting a template into a non-empty field asks for
 * confirmation inline instead of silently overwriting.
 */
export function PromptField({
  value,
  onChange,
  onKeyDown,
}: PromptFieldProps): ReactNode {
  const [pending, setPending] = useState<PromptTemplate | null>(null);

  const applyTemplate = (template: PromptTemplate) => {
    if (value.trim() && value !== template.prompt) {
      setPending(template);
      return;
    }
    setPending(null);
    onChange(template.prompt);
  };

  return (
    <div className="settings-field">
      <span className="settings-field-label">Instructions</span>
      <div className="prompt-templates" role="group" aria-label="Starter templates">
        {PROMPT_TEMPLATES.map((t) => (
          <button
            key={t.name}
            type="button"
            className="prompt-chip"
            onClick={() => applyTemplate(t)}
          >
            {t.name}
          </button>
        ))}
      </div>
      {pending && (
        <div className="prompt-overwrite" role="status">
          <span>Replace the current instructions with the {pending.name} template?</span>
          <button
            type="button"
            className="btn btn-md"
            onClick={() => {
              onChange(pending.prompt);
              setPending(null);
            }}
          >
            Replace
          </button>
          <button
            type="button"
            className="btn btn-md"
            onClick={() => setPending(null)}
          >
            Keep mine
          </button>
        </div>
      )}
      <textarea
        className="input prompt-textarea"
        aria-label="Instructions"
        value={value}
        rows={10}
        placeholder="You are…"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="prompt-count" aria-live="off">
        {value.length} chars
      </div>
    </div>
  );
}
