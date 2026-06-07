import type { ReactNode } from "react";

interface XaiIconProps {
  size?: number;
  className?: string;
}

// Brand mark sourced from @lobehub/icons-static-svg. Rendered monochrome via
// currentColor so it tints with the surrounding theme accent.
export function XaiIcon({ size = 16, className }: XaiIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="xAI"
      className={className}
      fill="currentColor"
    >
      <path
        d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z"
      />
    </svg>
  );
}

export default XaiIcon;
