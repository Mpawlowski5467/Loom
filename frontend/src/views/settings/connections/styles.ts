/** Layout classes shared by the connection cards. */

/** Two fields side by side, stacked on narrow screens. */
export const FIELD_ROW = "grid gap-3 sm:grid-cols-2";

/** A row of buttons that wraps. */
export const ACTION_ROW = "flex flex-wrap items-center gap-2";

/** A muted one-line status (next run, last poll, sign-in hint). */
export const NOTE = "text-xs text-muted-foreground";

/** A service block below the account controls of a connector card. */
export const SERVICE_BLOCK = "border-t border-border pt-4";

/** A Button with variant="link" that sits inline in a line of text. */
export const INLINE_LINK = "h-auto p-0 text-brand underline has-[>svg]:px-0";

/** A test result panel (events found, repos reachable). */
export const RESULT_PANEL =
  "flex flex-col gap-1.5 rounded-r-md border-l-2 border-brand bg-muted px-3 py-2.5 text-sm text-secondary-foreground";
