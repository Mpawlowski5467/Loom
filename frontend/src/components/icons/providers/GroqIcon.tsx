import type { ReactNode } from "react";

interface GroqIconProps {
  size?: number;
  className?: string;
}

export function GroqIcon({ size = 16, className }: GroqIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Groq"
      className={className}
      fill="currentColor"
    >
      <path
        d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v14h14V5H5Z"
      />
      <path d="M13.5 7.5 8 13h3.2l-1.7 4 5.5-5.5h-3.2l1.7-4Z" />
    </svg>
  );
}

export default GroqIcon;
