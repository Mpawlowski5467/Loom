import type { ReactNode } from "react";

interface MistralIconProps {
  size?: number;
  className?: string;
}

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
      <rect x="3" y="4" width="4" height="4" />
      <rect x="17" y="4" width="4" height="4" />
      <rect x="3" y="8" width="4" height="4" />
      <rect x="8" y="8" width="4" height="4" />
      <rect x="12" y="8" width="4" height="4" />
      <rect x="17" y="8" width="4" height="4" />
      <rect x="3" y="12" width="4" height="4" />
      <rect x="12" y="12" width="4" height="4" />
      <rect x="17" y="12" width="4" height="4" />
      <rect x="3" y="16" width="4" height="4" />
      <rect x="17" y="16" width="4" height="4" />
    </svg>
  );
}

export default MistralIcon;
