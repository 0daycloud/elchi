import React from "react";
import ElchiStar from "./ElchiStar";

// Product name; never translated.
const PRODUCT_NAME = "Elchi";

interface ElchiLogoProps {
  /** Wordmark cap size in px; the star scales with it. */
  size?: number;
  /** Ink for the star and the letters (defaults to the accent). */
  color?: string;
  className?: string;
}

/** Elchi wordmark: the eight-point star beside "Elchi" in Karla. */
const ElchiLogo: React.FC<ElchiLogoProps> = ({
  size = 28,
  color = "var(--color-logo-primary)",
  className = "",
}) => (
  <div
    className={`inline-flex items-center select-none ${className}`}
    style={{ gap: size * 0.32 }}
    role="img"
    aria-label={PRODUCT_NAME}
  >
    <ElchiStar size={size * 1.15} color={color} />
    <span
      aria-hidden="true"
      className="font-display font-bold leading-none"
      style={{ fontSize: size, letterSpacing: "-0.02em", color }}
    >
      {PRODUCT_NAME}
    </span>
  </div>
);

export default ElchiLogo;
