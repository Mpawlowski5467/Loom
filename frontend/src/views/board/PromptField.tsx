import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PROMPT_TEMPLATES, type PromptTemplate } from "./promptTemplates";

interface PromptFieldProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

/**
 * Instructions: starter templates above the text, with a live count.
 * Inserting a template over your own text asks first.
 */
export function PromptField({ value, onChange, onKeyDown }: PromptFieldProps) {
  const id = useId();
  const [pending, setPending] = useState<PromptTemplate | null>(null);
  const apply = (template: PromptTemplate) => {
    if (value.trim() && value !== template.prompt) return setPending(template);
    setPending(null);
    onChange(template.prompt);
  };
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Instructions</Label>
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Starter templates"
      >
        {PROMPT_TEMPLATES.map((t) => (
          <Button
            key={t.name}
            variant="outline"
            size="xs"
            className="rounded-full"
            onClick={() => apply(t)}
          >
            {t.name}
          </Button>
        ))}
      </div>
      {pending && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted p-2 text-sm"
        >
          <span className="flex-1">
            Replace the current instructions with the {pending.name} template?
          </span>
          <Button
            size="xs"
            onClick={() => {
              onChange(pending.prompt);
              setPending(null);
            }}
          >
            Replace
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setPending(null)}>
            Keep mine
          </Button>
        </div>
      )}
      <Textarea
        id={id}
        value={value}
        rows={10}
        placeholder="You are…"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-48 font-mono text-xs"
      />
      <p className="self-end font-mono text-[11px] text-muted-foreground">
        {value.length} chars
      </p>
    </div>
  );
}
