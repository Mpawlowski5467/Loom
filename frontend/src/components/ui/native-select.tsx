import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A native `<select>` styled like Input. Prefer it over the Radix Select
 * for plain form fields: it keeps the platform picker, works with form
 * semantics, and is testable with `selectOptions`.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
