import type { ReactNode } from "react";
import { AgentModelsCard } from "./AgentModelsCard";
import { HardwareScanCard } from "./HardwareScanCard";
import { ModelAdvisorCard } from "./ModelAdvisorCard";

export function HardwareSection(): ReactNode {
  return (
    <div className="settings-panel">
      <div className="settings-kicker">Hardware</div>
      <h1 className="settings-title">Hardware &amp; Models</h1>
      <p className="settings-copy">
        Profile this machine, see which local models it can run comfortably, and
        apply role-aware recommendations to Loom's built-in agents.
      </p>
      <HardwareScanCard />
      <ModelAdvisorCard />
      <AgentModelsCard />
    </div>
  );
}
