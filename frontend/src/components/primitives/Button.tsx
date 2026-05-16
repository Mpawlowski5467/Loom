import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "default" | "amber" | "purple" | "active";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  children: ReactNode;
}

export function Button({
  variant = "default",
  size = "sm",
  className,
  children,
  ...rest
}: ButtonProps): ReactNode {
  const classes = [
    "btn",
    variant === "amber" && "btn-amber",
    variant === "purple" && "btn-purple",
    variant === "active" && "btn-active",
    size === "md" && "btn-md",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
