import type { ReactNode } from "react";

interface TogetherIconProps {
  size?: number;
  className?: string;
}

export function TogetherIcon({ size = 16, className }: TogetherIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Together AI"
      className={className}
      fill="currentColor"
    >
      <circle cx="8" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="15.5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="9.5" r="1.3" />
      <circle cx="10" cy="13" r="1.3" />
      <circle cx="14" cy="13" r="1.3" />
    </svg>
  );
}

export default TogetherIcon;
