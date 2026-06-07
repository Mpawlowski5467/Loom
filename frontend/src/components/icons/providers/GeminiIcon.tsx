import type { ReactNode } from "react";

interface GeminiIconProps {
  size?: number;
  className?: string;
}

export function GeminiIcon({ size = 16, className }: GeminiIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Google Gemini"
      className={className}
      fill="currentColor"
    >
      {/* Four-pointed concave-sided star (sparkle) approximation */}
      <path d="M12 2c.55 6.1 3.9 9.45 10 10-6.1.55-9.45 3.9-10 10-.55-6.1-3.9-9.45-10-10C8.1 11.45 11.45 8.1 12 2Z" />
    </svg>
  );
}

export default GeminiIcon;
