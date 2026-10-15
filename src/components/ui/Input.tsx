import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "compact";
}

export const Input: React.FC<InputProps> = ({
  className = "",
  variant = "default",
  disabled,
  ...props
}) => {
  const baseClasses =
    "well text-[13px] text-start transition-all duration-150 placeholder:text-text/40";

  const interactiveClasses = disabled
    ? "opacity-60 cursor-not-allowed"
    : "focus:outline-none";

  const variantClasses = {
    default: "px-3.5 h-10",
    compact: "px-2.5 py-1",
  } as const;

  return (
    <input
      className={`${baseClasses} ${variantClasses[variant]} ${interactiveClasses} ${className}`}
      disabled={disabled}
      {...props}
    />
  );
};
