import type { ReactNode } from "react";
import {
  Palette,
  Server,
  ShieldAlert,
  SlidersHorizontal,
  Vault,
} from "lucide-react";
import { useApp } from "../context/app-ctx";
import type { SettingsSection } from "../data/types";
import { AppearanceSection } from "./settings/AppearanceSection";
import { AboutSection } from "./settings/AboutSection";
import { DangerZoneSection } from "./settings/DangerZoneSection";
import { ProvidersSection } from "./settings/ProvidersSection";
import { VaultSection } from "./settings/VaultSection";

const SECTIONS: {
  id: SettingsSection;
  label: string;
  icon: ReactNode;
}[] = [
  { id: "appearance", label: "Appearance", icon: <Palette size={15} /> },
  { id: "providers", label: "Providers", icon: <Server size={15} /> },
  { id: "vault", label: "Vault", icon: <Vault size={15} /> },
  { id: "about", label: "About", icon: <SlidersHorizontal size={15} /> },
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
  if (section === "appearance") return <AppearanceSection />;
  if (section === "providers") return <ProvidersSection />;
  if (section === "vault") return <VaultSection />;
  if (section === "about") return <AboutSection />;
  if (section === "danger") return <DangerZoneSection />;
  return (
    <div className="settings-panel">
      <div className="settings-kicker">{section}</div>
      <h1 className="settings-title">Coming next</h1>
      <p className="settings-copy">
        This section is reserved for the next settings slice.
      </p>
    </div>
  );
}
