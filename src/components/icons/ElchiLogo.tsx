import React from "react";
import ElchiStar from "./ElchiStar";

// Product name; never translated.
const PRODUCT_NAME = "Elchi";

interface ElchiLogoProps {
  /** Wordmark size in px; the star scales with it. */
  size?: number;
  /** Ink for the letters (defaults to the text color). */
  color?: string;
  /** Star variant: blue on neutral grounds, light on blue/field grounds. */
  tone?: "blue" | "light";
  className?: string;
}

/** Elchi wordmark: the star mark beside "Elchi" in Geist. */
const ElchiLogo: React.FC<ElchiLogoProps> = ({
  size = 15,
  color = "var(--color-text)",
  tone = "blue",
  className = "",
}) => (
  <div
    className={`inline-flex items-center select-none ${className}`}
    style={{ gap: size * 0.66 }}
    role="img"
    aria-label={PRODUCT_NAME}
  >
    <ElchiStar size={size * 1.2} tone={tone} />
    <span
      aria-hidden="true"
      className="font-sans font-medium leading-none"
      style={{ fontSize: size, letterSpacing: "-0.01em", color }}
    >
      {PRODUCT_NAME}
    </span>
  </div>
);

export default ElchiLogo;
