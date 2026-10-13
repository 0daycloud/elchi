import React from "react";

/** The eight-point star from Turkish tile work, Elchi's mark: 16 points in a
 *  100-unit box, with a coral eye. */
export const STAR_PATH =
  "M50 4 61 27 86 18 77 43 96 50 77 57 86 82 61 73 50 96 39 73 14 82 23 57 4 50 23 43 14 18 39 27Z";

interface ElchiStarProps {
  size?: number;
  /** Fill of the star's arms (any CSS color; defaults to the accent). */
  color?: string;
  /** Fill of the eye (defaults to the coral star token). */
  eye?: string;
  /** Color behind the eye ring, so the eye reads as a hole in the star. */
  ring?: string;
  className?: string;
}

const ElchiStar: React.FC<ElchiStarProps> = ({
  size = 28,
  color = "var(--color-logo-primary)",
  eye = "var(--color-star)",
  ring,
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    className={className}
    aria-hidden="true"
  >
    <path d={STAR_PATH} style={{ fill: color }} />
    {ring && <circle cx="50" cy="50" r="17" style={{ fill: ring }} />}
    <circle cx="50" cy="50" r="12" style={{ fill: eye }} />
  </svg>
);

export default ElchiStar;
