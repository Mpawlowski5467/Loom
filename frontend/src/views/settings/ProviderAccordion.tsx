import type { ReactNode } from "react";
import { CheckCircle2, ChevronDown, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConnectNote } from "./models/ConnectNote";
import type { ProviderAccordionProps } from "./models/providerCardProps";
import { ProviderFormFields } from "./models/ProviderFormFields";

/** One provider's card: a header that opens it, then its setup or form. */
export function ProviderAccordion(props: ProviderAccordionProps): ReactNode {
  const { meta, open } = props;
  const configured = Boolean(props.provider);
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
        type="button"
        aria-expanded={open}
        onClick={props.onToggle}
      >
        <span
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-brand"
          aria-hidden="true"
        >
          <meta.icon size={18} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <strong className="text-sm font-semibold text-foreground">
            {meta.label}
          </strong>
          <small className="truncate font-mono text-xs text-muted-foreground">
            {props.connectionLabel ??
              (configured ? "Account connected" : "Account not connected")}
          </small>
        </span>
        {configured && (
          <CheckCircle2
            className="size-4 shrink-0 text-ok-foreground"
            aria-hidden="true"
          />
        )}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
          <p className="text-sm text-muted-foreground">
            <strong className="font-medium text-foreground">
              Used in Loom:
            </strong>{" "}
            agents, Council chat, Researcher, Standup, capture processing, and
            summaries.
            {meta.supportsEmbed
              ? " It can also power semantic search and graph linking."
              : " Pair it with an embedding provider for semantic search and graph linking."}
          </p>
          {props.provider ? (
            <ProviderFormFields
              {...props}
              provider={props.provider}
              deleteDisabled={props.count <= 1}
            />
          ) : (
            <ProviderSetupNote {...props} />
          )}
        </div>
      )}
    </article>
  );
}

/** How an unconfigured provider connects: delegated sign-in or a key/host. */
function ProviderSetupNote(props: ProviderAccordionProps) {
  const { meta } = props;
  if (
    (meta.authMode === "codex" || meta.authMode === "oauth_pkce") &&
    props.onConnect
  ) {
    return (
      <ConnectNote
        title={`Connect ${meta.label}`}
        action={
          <Button
            size="sm"
            type="button"
            onClick={props.onConnect}
            disabled={props.authBusy}
          >
            <Link2 aria-hidden="true" />
            {props.authBusy ? "Opening…" : `Connect ${meta.label}`}
          </Button>
        }
      >
        {meta.authMode === "codex"
          ? "Sign in with ChatGPT through the local Codex credential store."
          : "Approve Loom in your browser; the resulting key is encrypted locally."}
      </ConnectNote>
    );
  }
  const apiKey = meta.authMode === "api_key";
  return (
    <ConnectNote
      title={apiKey ? `Connect ${meta.label}` : `Add ${meta.label}`}
      action={
        <Button size="sm" type="button" onClick={props.onAdd}>
          <Plus aria-hidden="true" />
          {apiKey ? "Connect with API key" : "Add provider"}
        </Button>
      }
    >
      {apiKey
        ? `${meta.label}'s developer account connects with a one-time API key. Loom encrypts it locally and never returns it.`
        : "Configure this local provider to make it available to Loom."}
    </ConnectNote>
  );
}
