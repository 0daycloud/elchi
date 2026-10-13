import React from "react";
import ElchiRosette from "./ElchiRosette";

// Product name; never translated.
const PRODUCT_NAME = "Elchi";

interface ElchiLogoProps {
  /** Wordmark cap size in px; the rosette scales with it. */
  size?: number;
  className?: string;
}

/**
 * Elchi wordmark: the rosette beside "Elchi" set in Bricolage Grotesque, with
 * the second ink printed slightly off register behind the letters.
 */
const ElchiLogo: React.FC<ElchiLogoProps> = ({ size = 28, className = "" }) => (
  <div
    className={`inline-flex items-center select-none ${className}`}
    style={{ gap: size * 0.28 }}
    role="img"
    aria-label={PRODUCT_NAME}
  >
    <ElchiRosette size={size * 1.15} />
    <span
      aria-hidden="true"
      className="font-display font-bold leading-none text-logo-primary"
      style={{
        fontSize: size,
        letterSpacing: "-0.02em",
        textShadow: `${Math.max(1, size * 0.05)}px ${Math.max(1, size * 0.04)}px 0 var(--color-ink-2)`,
      }}
    >
      {PRODUCT_NAME}
    </span>
  </div>
);

export default ElchiLogo;
