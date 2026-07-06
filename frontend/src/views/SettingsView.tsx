import type { ReactNode } from "react";
import {
  Archive,
  Cpu,
  Info,
  Palette,
  Server,
  ShieldAlert,
  Vault,
} from "lucide-react";
import { useApp } from "../context/app-ctx";
import type { SettingsSection } from "../data/types";
import { AppearanceSection } from "./settings/AppearanceSection";
import { AboutSection } from "./settings/AboutSection";
import { ArchivedSection } from "./settings/ArchivedSection";
import { DangerZoneSection } from "./settings/DangerZoneSection";
import { HardwareSection } from "./settings/HardwareSection";
import { ProvidersSection } from "./settings/ProvidersSection";
import { VaultSection } from "./settings/VaultSection";

const SECTIONS: {
  id: SettingsSection;
  label: string;
  icon: ReactNode;
}[] = [
  { id: "appearance", label: "Appearance", icon: <Palette size={15} /> },
  { id: "providers", label: "Providers", icon: <Server size={15} /> },
  { id: "hardware", label: "Hardware & Models", icon: <Cpu size={15} /> },
  { id: "vault", label: "Vault", icon: <Vault size={15} /> },
  { id: "archived", label: "Archived", icon: <Archive size={15} /> },
  { id: "about", label: "About", icon: <Info size={15} /> },
  { id: "danger", label: "Danger", icon: <ShieldAlert size={15} /> },
];

export function SettingsView(): ReactNode {
  const { settingsSection, setSettingsSection } = useApp();

  return (
    <section className="settings-view" aria-label="Settings">
      <aside className="settings-rail">
        <div className="settings-rail-title">Settings</div>
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              className="settings-nav-item"
              type="button"
              aria-current={settingsSection === section.id ? "page" : undefined}
              onClick={() => setSettingsSection(section.id)}
            >
              <span className="settings-nav-icon" aria-hidden="true">
                {section.icon}
              </span>
              <span>{section.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="settings-content">{renderSection(settingsSection)}</main>
    </section>
  );
}

function renderSection(section: SettingsSection): ReactNode {
  switch (section) {
    case "appearance":
      return <AppearanceSection />;
    case "providers":
      return <ProvidersSection />;
    case "hardware":
      return <HardwareSection />;
    case "vault":
      return <VaultSection />;
    case "archived":
      return <ArchivedSection />;
    case "about":
      return <AboutSection />;
    case "danger":
      return <DangerZoneSection />;
    default:
      // Exhaustiveness guard: adding a SettingsSection without a case here is
      // a compile error, not a silent "Coming next" placeholder.
      return assertNever(section);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled settings section: ${String(value)}`);
}
