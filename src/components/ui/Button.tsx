import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "primary-soft"
    | "secondary"
    | "warning"
    | "danger"
    | "danger-ghost"
    | "ghost";
  size?: "sm" | "md" | "lg";
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) => {
  const baseClasses =
    "inline-flex items-center justify-center gap-1.5 font-medium border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 transition-[background,color,border-color,opacity] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

  // Recipes from src/styles/recipes.css: chrome pill for the one primary
  // action, steel chips for everything secondary.
  const variantClasses = {
    primary: "chrome-cta border-transparent rounded-full",
    "primary-soft":
      "steel-chip text-logo-primary hover:brightness-110 rounded-md",
    secondary: "steel-chip hover:brightness-110 rounded-md",
    warning: "steel-chip rounded-md hover:border-warning hover:text-warning",
    danger:
      "text-white bg-error border-transparent rounded-md hover:brightness-110",
    "danger-ghost":
      "text-error border-transparent rounded-md hover:bg-error/10 focus:bg-error/15",
    ghost:
      "text-current border-transparent rounded-md hover:bg-text/[0.06] focus:bg-text/[0.08]",
  };

  const sizeClasses = {
    sm: "px-2.5 py-1 text-xs",
    md: "px-3.5 py-[6px] text-[13px]",
    lg: "px-4 py-2 text-sm",
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
