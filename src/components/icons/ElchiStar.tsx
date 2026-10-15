import React, { useId } from "react";

/** Elchi's mark: a five-point star in a 100-unit box (Claude Design,
 *  "Elchi Redesign"). It stays a small logo mark; the spectrogram is the
 *  brand visual. */
export const STAR_PATH =
  "M50 0 61 35 98 35 68 57 79 91 50 70 21 91 32 57 2 35 39 35Z";

interface ElchiStarProps {
  size?: number;
  /** Solid fill. Omit for the default blue steel gradient. */
  color?: string;
  /** "light" is the pale variant for use on blue or field backgrounds. */
  tone?: "blue" | "light";
  className?: string;
}

const STOPS = {
  blue: ["#9DB0FF", "#2140FF", "#0B1670"],
  light: ["#FFFFFF", "#9DB0FF", "#5C76FF"],
} as const;

const ElchiStar: React.FC<ElchiStarProps> = ({
  size = 18,
  color,
  tone = "blue",
  className,
}) => {
  const id = useId();
  const [a, b, c] = STOPS[tone];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      {!color && (
        <defs>
          {/* 160deg in CSS terms: from the top-left toward the bottom. */}
          <linearGradient id={id} x1="0.33" y1="0" x2="0.67" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset="0.55" stopColor={b} />
            <stop offset="1" stopColor={c} />
          </linearGradient>
        </defs>
      )}
      <path d={STAR_PATH} style={{ fill: color ?? `url(#${id})` }} />
    </svg>
  );
};

export default ElchiStar;
