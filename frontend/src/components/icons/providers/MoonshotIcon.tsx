import type { ReactNode } from "react";

interface MoonshotIconProps {
  size?: number;
  className?: string;
}

/** Loom's monochrome crescent treatment for Moonshot AI. */
export function MoonshotIcon({
  size = 16,
  className,
}: MoonshotIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Moonshot AI"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.1 15.2A8.4 8.4 0 0 1 8.8 3.9 8.6 8.6 0 1 0 20.1 15.2Z" />
      <path d="m17.4 4.1.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5Z" />
    </svg>
  );
}

export default MoonshotIcon;
