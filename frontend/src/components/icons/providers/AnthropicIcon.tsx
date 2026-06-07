import type { ReactNode } from "react";

interface AnthropicIconProps {
  size?: number;
  className?: string;
}

export function AnthropicIcon({ size = 16, className }: AnthropicIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Anthropic"
      className={className}
      fill="currentColor"
    >
      {/* Stylized splayed "A" burst mark (approximation, not the official logo) */}
      <path d="M13.1 4h3.2l5.7 16h-3.4l-1.17-3.4h-5.86L10.4 20H7l5.7-16h.4Zm.3 4.2-1.96 5.7h3.92L13.4 8.2Z" />
      <path d="M7.7 4h3.1L5.1 20H2L7.7 4Z" />
    </svg>
  );
}

export default AnthropicIcon;
