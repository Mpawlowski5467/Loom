import type { ReactNode } from "react";

interface MistralIconProps {
  size?: number;
  className?: string;
}

// Brand mark sourced from Simple Icons (MIT). Rendered monochrome via
// currentColor so it tints with the surrounding theme accent.
export function MistralIcon({ size = 16, className }: MistralIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Mistral"
      className={className}
      fill="currentColor"
    >
      <path
        d="M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z"
      />
    </svg>
  );
}

export default MistralIcon;
