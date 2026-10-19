import type { ReactNode } from "react";

/** The numbered steps for registering your own OAuth app. */
export function SetupChecklist({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-sm text-secondary-foreground marker:text-muted-foreground [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_code]:font-mono [&_code]:text-xs">
      {steps.map((step, index) => (
        <li key={index}>{step}</li>
      ))}
    </ol>
  );
}
