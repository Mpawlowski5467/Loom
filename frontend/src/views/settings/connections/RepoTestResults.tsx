import { Check, X } from "lucide-react";
import type { GitHubTestResult } from "@/api/automations";
import { RESULT_PANEL } from "./styles";

/** Which repositories the saved token can reach. */
export function RepoTestResults({ result }: { result: GitHubTestResult }) {
  const reachable = result.repos.filter((repo) => repo.ok).length;
  return (
    <div role="status" aria-live="polite" className={RESULT_PANEL}>
      <strong className="font-medium text-foreground">
        {reachable} of {result.repos.length} repos reachable
      </strong>
      {result.repos.map((repo) => (
        <span key={repo.repo} className="flex items-start gap-1.5">
          {repo.ok ? (
            <Check
              role="img"
              aria-label="Reachable"
              className="mt-0.5 size-3.5 shrink-0 text-ok-foreground"
            />
          ) : (
            <X
              role="img"
              aria-label="Unreachable"
              className="mt-0.5 size-3.5 shrink-0 text-danger-foreground"
            />
          )}
          <span className="min-w-0 break-words">
            {repo.repo}
            {repo.ok
              ? repo.description
                ? ` — ${repo.description}`
                : ""
              : ` — ${repo.error}`}
          </span>
        </span>
      ))}
    </div>
  );
}
