import type { ReactNode } from "react";

interface OllamaIconProps {
  size?: number;
  className?: string;
}

export function OllamaIcon({ size = 16, className }: OllamaIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Ollama"
      className={className}
      fill="currentColor"
    >
      {/* Llama head silhouette — two upright ears, rounded crown, tapering muzzle */}
      <path
        d="M7.3 2.4c.7 0 1.2.7 1.4 1.6.2.9.2 1.9.1 2.7.9-.4 1.9-.6 3.1-.6s2.2.2 3.1.6c-.1-.8-.1-1.8.1-2.7.2-.9.7-1.6 1.4-1.6.8 0 1.3.9 1.4 2 .1 1 0 2.2-.3 3.2 1 1 1.6 2.3 1.6 3.9v4.2c0 1.6-.6 2.6-1.7 3.2-.5 1.4-1.1 2.5-2 2.9-.2.1-.4-.1-.4-.3v-1.3c0-.3-.2-.5-.5-.5h-1c-.3 0-.5.2-.5.5v1.5c0 .3-.2.5-.5.5h-1.6c-.3 0-.5-.2-.5-.5v-1.5c0-.3-.2-.5-.5-.5h-1c-.3 0-.5.2-.5.5v1.3c0 .2-.2.4-.4.3-.9-.4-1.5-1.5-2-2.9C5.6 18.8 5 17.8 5 16.2V12c0-1.6.6-2.9 1.6-3.9-.3-1-.4-2.2-.3-3.2.1-1.1.6-2 1.4-2zm2.4 8.1c-.6 0-1.1.6-1.1 1.3s.5 1.3 1.1 1.3 1.1-.6 1.1-1.3-.5-1.3-1.1-1.3zm4.6 0c-.6 0-1.1.6-1.1 1.3s.5 1.3 1.1 1.3 1.1-.6 1.1-1.3-.5-1.3-1.1-1.3z"
      />
    </svg>
  );
}

export default OllamaIcon;
