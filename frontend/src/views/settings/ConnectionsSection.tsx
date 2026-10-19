import { SettingsGroup } from "@/views/settings/kit/SettingsGroup";
import { GoogleConnectorCard } from "./GoogleConnectorCard";
import { CalendarFeedCard } from "./connections/CalendarFeedCard";
import { EmailCard } from "./connections/EmailCard";
import { GitHubCard } from "./connections/GitHubCard";
import { OutlookCalendarConnection } from "./connections/OutlookCalendarConnection";
import { StandupCard } from "./connections/StandupCard";
import { useStandupAutomation } from "./connections/useStandupAutomation";

/**
 * Settings → Integrations: the Standup schedule, the OAuth connectors
 * (Google, Outlook), then the credential bridges (iCal feed, GitHub, IMAP).
 */
export function ConnectionsSection() {
  // The Standup schedule and the iCal feed are one config, saved together.
  const standup = useStandupAutomation();
  return (
    <SettingsGroup
      level={1}
      title="Accounts & Automations"
      description="Connect accounts once, choose what Loom may read, and turn selected activity into durable Inbox captures. Loom never posts, sends, or modifies anything in your connected accounts."
    >
      <div className="flex flex-col gap-8">
        <StandupCard standup={standup} />
        <GoogleConnectorCard />
        <OutlookCalendarConnection />
        <CalendarFeedCard standup={standup} />
        <GitHubCard />
        <EmailCard />
      </div>
    </SettingsGroup>
  );
}
