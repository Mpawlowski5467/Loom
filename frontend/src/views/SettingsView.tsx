import type { ReactNode } from "react";
import {
  Bot,
  Cpu,
  Info,
  Link2,
  Palette,
  ShieldCheck,
  Vault,
} from "lucide-react";
import { NavLink } from "react-router";
import { useApp } from "../context/app-ctx";
import type { SettingsSection } from "../data/types";
import { settingsPath } from "../app/routes";
import { cn } from "@/lib/utils";
import { AppearanceSection } from "./settings/AppearanceSection";
import { AboutSection } from "./settings/AboutSection";
import { AgentModelsCard } from "./settings/AgentModelsCard";
import { ConnectionsSection } from "./settings/ConnectionsSection";
import { ArchivedSection } from "./settings/ArchivedSection";
import { DangerZoneSection } from "./settings/DangerZoneSection";
import { HardwareScanCard } from "./settings/HardwareScanCard";
import { ModelAdvisorCard } from "./settings/ModelAdvisorCard";
import { ProvidersSection } from "./settings/ProvidersSection";
import { VaultSection } from "./settings/VaultSection";
import { PolicySection } from "./settings/PolicySection";
import { SettingsPage } from "./settings/kit/SettingsPage";
import { SettingsGroup } from "./settings/kit/SettingsGroup";

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: "general", label: "General", icon: <Info /> },
  { id: "appearance", label: "Appearance", icon: <Palette /> },
  { id: "agents", label: "Agents", icon: <Bot /> },
  { id: "models", label: "Models & providers", icon: <Cpu /> },
  { id: "privacy", label: "Privacy", icon: <ShieldCheck /> },
  { id: "integrations", label: "Integrations", icon: <Link2 /> },
  { id: "vault", label: "Vault", icon: <Vault /> },
];

/**
 * Settings: a section nav routed by `/settings/:section`. Each page has one
 * h1 (its first SettingsGroup) and h2 groups below it.
 */
export function SettingsView(): ReactNode {
  const { settingsSection } = useApp();
  return (
    <section
      aria-label="Settings"
      className="flex min-h-0 flex-1 flex-col bg-background lg:flex-row"
    >
      <aside className="shrink-0 border-b border-border bg-sidebar p-3 lg:w-60 lg:border-r lg:border-b-0">
        <h2 className="px-2 pb-2 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
          Settings
        </h2>
        <nav
          aria-label="Settings sections"
          className="flex flex-wrap gap-1 lg:flex-col"
        >
          {SECTIONS.map((section) => (
            <NavLink
              key={section.id}
              to={settingsPath(section.id)}
              className={({ isActive }) =>
                cn(
                  "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-secondary-foreground transition-colors [&_svg]:size-4 [&_svg]:text-muted-foreground",
                  "hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  isActive &&
                    "bg-nav-active font-medium text-nav-active-foreground",
                )
              }
            >
              <span aria-hidden="true">{section.icon}</span>
              {section.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8 lg:px-12">
        {settingsSection === "appearance" ? (
          <AppearanceSection />
        ) : (
          <SettingsPage>{renderSection(settingsSection)}</SettingsPage>
        )}
      </div>
    </section>
  );
}

function renderSection(section: SettingsSection): ReactNode {
  switch (section) {
    case "general":
      return <AboutSection />;
    case "appearance":
      return <AppearanceSection />;
    case "agents":
      return (
        <SettingsGroup
          level={1}
          title="Agent models"
          description="Choose the provider and model each of Loom's built-in agents uses."
        >
          <AgentModelsCard />
        </SettingsGroup>
      );
    case "models":
      return (
        <>
          <ProvidersSection />
          <SettingsGroup
            title="This machine"
            description="Profile this machine and see which local models it can run comfortably."
          >
            <HardwareScanCard />
            <ModelAdvisorCard />
          </SettingsGroup>
        </>
      );
    case "privacy":
      return <PolicySection />;
    case "integrations":
      return <ConnectionsSection />;
    case "vault":
      return (
        <>
          <VaultSection />
          <ArchivedSection />
          <DangerZoneSection />
        </>
      );
    default:
      // Exhaustiveness guard: a new SettingsSection without a case here is a
      // compile error, not a silent blank page.
      return assertNever(section);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled settings section: ${String(value)}`);
}
