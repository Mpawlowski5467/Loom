import type { ReactNode } from "react";

interface DeepSeekIconProps {
  size?: number;
  className?: string;
}

export function DeepSeekIcon({ size = 16, className }: DeepSeekIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="DeepSeek"
      className={className}
      fill="currentColor"
    >
      <path d="M3 11c2.6-.4 4.9.5 6.9 2.2 1 .9 1.9 1.3 3 1.3 1.4 0 2.6-.7 3.5-1.9-.4 2.7-2.5 4.7-5.2 4.7-1.6 0-3-.7-4-1.9 1 2.6 3.4 4.3 6.4 4.3 1 0 1.9-.2 2.8-.5-1.9 1.7-4.3 2.5-6.9 2.1C7.9 20.8 5 18.1 4 14.3c.9.5 1.9.7 2.9.6-1.9-1-3.2-2.5-3.9-3.9z" />
      <circle cx="17.5" cy="9.5" r="1.1" />
    </svg>
  );
}

export default DeepSeekIcon;
