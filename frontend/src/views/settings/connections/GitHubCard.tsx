import { Link2Off, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/views/settings/kit/Field";
import { SettingsCard } from "@/views/settings/kit/SettingsCard";
import { SettingsGroup } from "@/views/settings/kit/SettingsGroup";
import { AlertLine } from "./AlertLine";
import { CheckboxField } from "./CheckboxField";
import { EnableSwitch } from "./EnableSwitch";
import { GitHubAuth } from "./GitHubAuth";
import { PollStatus } from "./PollStatus";
import { RepoTestResults } from "./RepoTestResults";
import { ACTION_ROW, FIELD_ROW } from "./styles";
import { useGitHubBridge } from "./useGitHubBridge";

/** The GitHub bridge: polls repos for commits, issues and PRs. */
export function GitHubCard() {
  const bridge = useGitHubBridge();
  const { github, busy } = bridge;
  const tokenSaved = github?.github.token_set ?? false;
  const noRepos = !bridge.repos.trim();

  return (
    <SettingsGroup
      title="GitHub account"
      description="Poll GitHub repos for new commits, issues, and PRs — activity lands in the Inbox for triage."
      actions={
        <EnableSwitch
          label="Enable GitHub connection"
          checked={bridge.enabled}
          onCheckedChange={bridge.setEnabled}
          disabled={!github || busy !== null || (!bridge.enabled && noRepos)}
        />
      }
    >
      <SettingsCard>
        <GitHubAuth bridge={bridge} />
        <Field label="Repositories — one owner/name per line">
          <Textarea
            className="min-h-20 font-mono"
            value={bridge.repos}
            onChange={(event) => bridge.setRepos(event.target.value)}
            placeholder={"octocat/hello-world\nyour-org/private-repo"}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <div className={FIELD_ROW}>
          <Field label="Poll interval (minutes)">
            <Input
              type="number"
              min={5}
              max={1440}
              value={bridge.intervalMinutes}
              onChange={(event) =>
                bridge.setIntervalMinutes(event.target.value)
              }
            />
          </Field>
          <Field label="Lookback (hours)">
            <Input
              type="number"
              min={1}
              max={720}
              value={bridge.lookbackHours}
              onChange={(event) => bridge.setLookbackHours(event.target.value)}
            />
          </Field>
        </div>
        <CheckboxField
          label="Include commits"
          hint="New commits on each repo's default branch."
          checked={bridge.includeCommits}
          onCheckedChange={bridge.setIncludeCommits}
        />
        <CheckboxField
          label="Include issues"
          hint="Issues opened or updated in the lookback window."
          checked={bridge.includeIssues}
          onCheckedChange={bridge.setIncludeIssues}
        />
        <CheckboxField
          label="Include pull requests"
          hint="PRs opened or updated in the lookback window."
          checked={bridge.includePRs}
          onCheckedChange={bridge.setIncludePRs}
        />

        <div className={ACTION_ROW}>
          <Button
            type="button"
            size="sm"
            aria-label="Save GitHub settings"
            onClick={() => void bridge.save()}
            disabled={!github || busy !== null}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Test GitHub connection"
            onClick={() => void bridge.test()}
            disabled={!github || busy !== null || noRepos}
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void bridge.sync()}
            disabled={!github || busy !== null || noRepos}
          >
            <RefreshCw aria-hidden="true" />
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </Button>
          {tokenSaved && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Disconnect GitHub"
              onClick={() => void bridge.disconnect()}
              disabled={busy !== null}
            >
              <Link2Off aria-hidden="true" /> Disconnect
            </Button>
          )}
        </div>

        {bridge.error && <AlertLine>{bridge.error}</AlertLine>}
        {bridge.testResult && <RepoTestResults result={bridge.testResult} />}
        {bridge.syncErrors.map((repo) => (
          <AlertLine key={repo.repo}>
            {repo.repo}: {repo.error}
          </AlertLine>
        ))}
        <PollStatus status={github?.status} />
      </SettingsCard>
    </SettingsGroup>
  );
}
