import { CloudOff, PlugZap } from "lucide-react";
import { Link } from "react-router";
import type { ReactNode } from "react";

function Banner({
  icon,
  tone,
  children,
}: {
  icon: ReactNode;
  tone: "info" | "warning";
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={
        tone === "info"
          ? "flex items-center gap-2 border-b border-banner-border bg-banner px-4 py-1.5 text-sm text-banner-foreground"
          : "flex items-center gap-2 border-b border-warning-border bg-warning px-4 py-1.5 text-sm text-warning-foreground"
      }
    >
      <span aria-hidden="true" className="[&_svg]:size-4">
        {icon}
      </span>
      <span>{children}</span>
    </div>
  );
}

export function ProviderBanner() {
  return (
    <Banner icon={<PlugZap />} tone="info">
      No AI provider configured. Loom's agents are paused until you add one in{" "}
      <Link to="/settings/models" className="underline underline-offset-2">
        Settings
      </Link>
      .
    </Banner>
  );
}

export function OfflineBanner() {
  return (
    <Banner icon={<CloudOff />} tone="warning">
      Backend unreachable. Saving is unavailable until the connection returns.
    </Banner>
  );
}
