import type { ReactNode } from "react";
import { AgentModelsCard } from "./AgentModelsCard";
import { HardwareScanCard } from "./HardwareScanCard";
import { SettingsGroup } from "./kit/SettingsGroup";
import { ModelAdvisorCard } from "./ModelAdvisorCard";

export function HardwareSection(): ReactNode {
  return (
    <SettingsGroup
      level={1}
      title="Hardware & Models"
      description="Profile this machine, see which local models it can run comfortably, and apply role-aware recommendations to Loom's built-in agents."
    >
      <HardwareScanCard />
      <ModelAdvisorCard />
      <AgentModelsCard />
    </SettingsGroup>
  );
}
