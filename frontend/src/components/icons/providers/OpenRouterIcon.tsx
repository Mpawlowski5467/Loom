import type { ReactNode } from "react";

interface OpenRouterIconProps {
  size?: number;
  className?: string;
}

export function OpenRouterIcon({ size = 16, className }: OpenRouterIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="OpenRouter"
      className={className}
      fill="currentColor"
    >
      <path
        d="M4 12h3.5l3 -3h3M4 12h3.5l3 3h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="4" cy="12" r="1.8" />
      <circle cx="17.5" cy="9" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17.5" cy="15" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export default OpenRouterIcon;
