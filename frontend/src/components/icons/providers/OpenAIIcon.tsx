import type { ReactNode } from "react";

interface OpenAIIconProps {
  size?: number;
  className?: string;
}

export function OpenAIIcon({ size = 16, className }: OpenAIIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="OpenAI"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 2.8a4.2 4.2 0 0 1 3.64 6.3" />
      <path d="M15.64 4.9a4.2 4.2 0 0 1 3.64 6.3" />
      <path d="M19.28 11.2a4.2 4.2 0 0 1-3.64 6.3" />
      <path d="M15.64 17.5a4.2 4.2 0 0 1-7.28 0" />
      <path d="M8.36 17.5a4.2 4.2 0 0 1-3.64-6.3" />
      <path d="M4.72 11.2a4.2 4.2 0 0 1 3.64-6.3" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  );
}

export default OpenAIIcon;
