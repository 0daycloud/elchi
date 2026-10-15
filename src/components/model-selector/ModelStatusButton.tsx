import React from "react";

type ModelStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "verifying"
  | "extracting"
  | "error"
  | "unloaded"
  | "none";

interface ModelStatusButtonProps {
  status: ModelStatus;
  displayText: string;
  isDropdownOpen: boolean;
  onClick: () => void;
  /** False renders a plain status label: no dropdown chevron, not a button. */
  interactive?: boolean;
  className?: string;
}

/** The status dot: the glowing blue dot when ready, red on errors. */
const StatusDot: React.FC<{ status: ModelStatus }> = ({ status }) => {
  switch (status) {
    case "ready":
      return <span aria-hidden="true" className="dot-accent shrink-0" />;
    case "loading":
    case "downloading":
    case "verifying":
    case "extracting":
      return (
        <span
          aria-hidden="true"
          className="dot-accent shrink-0 motion-safe:animate-pulse"
        />
      );
    case "error":
    case "none":
      return (
        <span
          aria-hidden="true"
          className="w-1.5 h-1.5 rounded-full shrink-0 bg-error"
        />
      );
    default:
      return (
        <span
          aria-hidden="true"
          className="w-1.5 h-1.5 rounded-full shrink-0 bg-text/30"
        />
      );
  }
};

// Mono and uppercase, like every label in the footer bar.
const LABEL = "font-mono text-[10.5px] uppercase tracking-[0.06em]";

const ModelStatusButton: React.FC<ModelStatusButtonProps> = ({
  status,
  displayText,
  isDropdownOpen,
  onClick,
  interactive = true,
  className = "",
}) => {
  if (!interactive) {
    return (
      <span className={`flex items-center gap-2 ${LABEL} ${className}`}>
        <StatusDot status={status} />
        <span>{displayText}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-sm ${LABEL} hover:text-text/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${className}`}
      title={displayText}
    >
      <StatusDot status={status} />
      <span className="max-w-28 truncate">{displayText}</span>
      <svg
        aria-hidden="true"
        className={`w-3 h-3 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>
  );
};

export default ModelStatusButton;
