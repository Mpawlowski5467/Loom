import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Field } from "@/views/settings/kit/Field";
import { GitHubSignIn } from "../GitHubSignIn";
import { FieldBadge } from "./FieldBadge";
import { INLINE_LINK } from "./styles";
import type { GitHubBridgeState } from "./useGitHubBridge";

/**
 * How Loom reaches GitHub: "Sign in with GitHub" when Loom ships an app (a
 * personal access token stays available behind a disclosure), otherwise a
 * token field.
 */
export function GitHubAuth({ bridge }: { bridge: GitHubBridgeState }) {
  const { github } = bridge;
  const tokenSaved = github?.github.token_set ?? false;
  const tokenField = (
    <Field
      label={
        <>
          Personal access token{" "}
          {tokenSaved && <FieldBadge>token saved</FieldBadge>}
        </>
      }
    >
      <Input
        type="password"
        value={bridge.token}
        onChange={(event) => bridge.setToken(event.target.value)}
        placeholder={
          tokenSaved
            ? "ghp_… (leave blank to keep current)"
            : "ghp_… or github_pat_…"
        }
        autoComplete="off"
        spellCheck={false}
      />
    </Field>
  );

  if (!github?.builtin_app) return tokenField;
  return (
    <>
      <GitHubSignIn
        account={github.github.account ?? ""}
        onConnected={bridge.handleSignedIn}
        onSignOut={bridge.signOut}
        disabled={bridge.busy !== null}
      />
      {!github.github.account && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="link"
              className={cn(INLINE_LINK, "group gap-1")}
            >
              <ChevronRight
                aria-hidden="true"
                className="transition-transform group-data-[state=open]:rotate-90"
              />
              Use a personal access token instead
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">{tokenField}</CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}
