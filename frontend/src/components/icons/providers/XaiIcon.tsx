import type { ReactNode } from "react";

interface XaiIconProps {
  size?: number;
  className?: string;
}

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
      <path d="M3.6 3h3.4l5 7.1L7 3h3.5l3.6 5.1L11.4 12 18 21h-3.4l-5.1-7.2L13 21H9.5L5.8 15.8 8.4 12 3.6 3z" />
      <path d="M16.2 3H20l-5 7 5 11h-3.6l-3.7-8.2L16.2 3z" />
    </svg>
  );
}

export default XaiIcon;
