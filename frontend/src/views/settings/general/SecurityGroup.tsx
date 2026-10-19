import { TriangleAlert } from "lucide-react";
import type { DiagnosticsResponse } from "@/api/diagnostics";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SettingsGroup } from "../kit/SettingsGroup";
import { InfoGrid, InfoRow } from "./InfoGrid";

function networkScope(diagnostics: DiagnosticsResponse | null): string {
  if (!diagnostics) return "…";
  return diagnostics.local_only ? "Localhost only" : "Custom hosts enabled";
}

/** Who can reach the API, and warnings when that is wider than localhost. */
export function SecurityGroup({
  diagnostics,
}: {
  diagnostics: DiagnosticsResponse | null;
}) {
  return (
    <SettingsGroup title="Local access boundary">
      <InfoGrid>
        <InfoRow label="Network scope" value={networkScope(diagnostics)} />
        <InfoRow
          label="API token"
          value={
            diagnostics?.api_token_configured ? "Configured" : "Not configured"
          }
        />
        <InfoRow label="Secrets" value={diagnostics?.secret_storage ?? "…"} />
        <InfoRow
          label="Allowed hosts"
          value={diagnostics?.allowed_hosts.join(", ") ?? "…"}
          mono
        />
      </InfoGrid>
      {diagnostics?.security_warnings.map((warning) => (
        <Alert key={warning} variant="warning" role="status">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="text-warning-foreground">
            {warning}
          </AlertDescription>
        </Alert>
      ))}
    </SettingsGroup>
  );
}
