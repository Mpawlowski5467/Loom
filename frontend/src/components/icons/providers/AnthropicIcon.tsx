import type { ReactNode } from "react";

interface AnthropicIconProps {
  size?: number;
  className?: string;
}

// Brand mark sourced from Simple Icons (MIT). Rendered monochrome via
// currentColor so it tints with the surrounding theme accent.
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
      <path
        d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"
      />
    </svg>
  );
}

export default AnthropicIcon;
