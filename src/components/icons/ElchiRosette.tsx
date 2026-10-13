import React from "react";

// The 8-petal Iznik rosette from the brand films (motifs.ts): eight ellipses
// at radius 24 (rx 17, ry 9) in a 100-unit box centred on 0.
const PETALS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return {
    cx: Math.cos(a) * 24,
    cy: Math.sin(a) * 24,
    deg: (a * 180) / Math.PI,
  };
});

const Petals: React.FC<{ fill: string; dx?: number; dy?: number }> = ({
  fill,
  dx = 0,
  dy = 0,
}) => (
  <g style={{ fill }} transform={`translate(${dx} ${dy})`}>
    {PETALS.map(({ cx, cy, deg }) => (
      <ellipse
        key={deg}
        cx={cx}
        cy={cy}
        rx={17}
        ry={9}
        transform={`rotate(${deg} ${cx} ${cy})`}
      />
    ))}
  </g>
);

interface ElchiRosetteProps {
  size?: number;
  className?: string;
}

/**
 * Two-ink rosette: the second ink sits slightly off register under the
 * accent ink, and the paper shows through the centre ring, as in a riso print.
 * Colours follow the theme tokens, so it reads on paper and on night.
 */
const ElchiRosette: React.FC<ElchiRosetteProps> = ({
  size = 28,
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="-46 -46 92 92"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <Petals fill="var(--color-ink-2)" dx={2.4} dy={1.8} />
    <Petals fill="var(--color-logo-primary)" />
    <circle r={12.5} style={{ fill: "var(--color-background)" }} />
    <circle cx={1.4} cy={1.1} r={7.5} style={{ fill: "var(--color-ink-2)" }} />
    <circle r={5.2} style={{ fill: "var(--color-logo-primary)" }} />
  </svg>
);

export default ElchiRosette;
