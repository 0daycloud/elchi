import React, { useEffect, useRef } from "react";

/**
 * Elchi's brand visual: a pixel field rendered on a canvas in 3-4px cells,
 * ported from the Claude Design "Elchi Redesign" file.
 *
 *  - `spec`  a spectrogram on near-black (the home hero, empty states).
 *            Pass `energy` to shape it from real data (e.g. words per day).
 *  - `field` a dark blue noise field with banded glitches (onboarding,
 *            behind the overlay previews).
 *  - `pro`   the total-blue zone texture (Duyu Pro card, upsell, light hero);
 *            it fades in from the left so text can sit on flat blue.
 *
 * Texture is deterministic for a given seed and size; it redraws on resize.
 */
export type SpectralMode = "spec" | "field" | "pro";

interface SpectralCanvasProps {
  mode: SpectralMode;
  seed?: number;
  /** spec only: 0..1 loudness samples spread across the width. */
  energy?: number[];
  /** Re-seed every `animateMs` for a slow living shimmer (field only). */
  animateMs?: number;
  className?: string;
  style?: React.CSSProperties;
}

type Noise = {
  hash: (x: number, y: number, s: number) => number;
  vn: (x: number, y: number, s: number) => number;
  fbm: (x: number, y: number, s: number) => number;
  cl: (v: number) => number;
};

const makeNoise = (): Noise => {
  const hash = (x: number, y: number, s: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const sm = (t: number) => t * t * (3 - 2 * t);
  const vn = (x: number, y: number, s: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = sm(x - xi);
    const v = sm(y - yi);
    const a = hash(xi, yi, s);
    const b = hash(xi + 1, yi, s);
    const c = hash(xi, yi + 1, s);
    const d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x: number, y: number, s: number) =>
    vn(x, y, s) * 0.5 +
    vn(x * 2, y * 2, s + 1) * 0.25 +
    vn(x * 4, y * 4, s + 2) * 0.125 +
    vn(x * 8, y * 8, s + 3) * 0.0625;
  const cl = (v: number) => Math.max(0, Math.min(1, v));
  return { hash, vn, fbm, cl };
};

const N = makeNoise();

const grid = (
  g: CanvasRenderingContext2D,
  W: number,
  H: number,
  step: number,
  alpha: number,
) => {
  g.strokeStyle = `rgba(255,255,255,${alpha})`;
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x < W; x += step) {
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, H);
  }
  for (let y = 0; y < H; y += step) {
    g.moveTo(0, y + 0.5);
    g.lineTo(W, y + 0.5);
  }
  g.stroke();
};

/** Copy horizontal strips of the canvas sideways: the "glitch" bands. */
const bands = (
  g: CanvasRenderingContext2D,
  c: HTMLCanvasElement,
  dpr: number,
  W: number,
  H: number,
  s: number,
  ground: string,
  list: [number, number, number, number][],
) => {
  for (const [fy, hCells, shiftCells, lift] of list) {
    const y = Math.round((fy * H) / s) * s;
    const hh = hCells * s;
    const dx = shiftCells * s;
    g.drawImage(c, 0, y * dpr, c.width, hh * dpr, dx, y, W, hh);
    if (dx > 0) {
      g.fillStyle = ground;
      g.fillRect(0, y, dx, hh);
    }
    if (lift) {
      g.fillStyle = `rgba(255,255,255,${lift})`;
      g.fillRect(0, y, W, hh);
    }
  }
};

const sampleEnergy = (energy: number[], nx: number) => {
  if (energy.length === 0) return 0;
  if (energy.length === 1) return energy[0];
  const p = nx * (energy.length - 1);
  const i = Math.floor(p);
  const f = p - i;
  const a = energy[i];
  const b = energy[Math.min(energy.length - 1, i + 1)];
  return a + (b - a) * f;
};

const drawSpec = (
  g: CanvasRenderingContext2D,
  W: number,
  H: number,
  seed: number,
  energy?: number[],
) => {
  const s = 4;
  const cols = Math.ceil(W / s);
  const rows = Math.ceil(H / s);
  const pal = [
    "#06060A",
    "#0B1670",
    "#1327C4",
    "#2140FF",
    "#5C76FF",
    "#9DB0FF",
    "#E4E9FF",
  ];
  g.fillStyle = pal[0];
  g.fillRect(0, 0, W, H);
  const topQuiet = 56 / H;
  const botQuiet = 34 / H;
  for (let x = 0; x < cols; x++) {
    const nx = x / cols;
    const texture = N.cl(N.fbm(nx * 7, 0.2, seed) * 1.6 - 0.1);
    // Real data sets the envelope; the noise keeps it looking like speech.
    const e = energy
      ? N.cl(sampleEnergy(energy, nx) * (0.55 + 0.6 * texture))
      : texture;
    const voiced = 0.35 + 0.65 * N.cl(N.vn(nx * 18, 0, seed + 4) * 1.6 - 0.2);
    const f0 = 2 + Math.round(N.fbm(nx * 5, 1, seed + 8) * 4);
    for (let y = 0; y < rows; y++) {
      const ny = 1 - y / rows;
      if (ny > 1 - topQuiet || ny < botQuiet) continue;
      const fy = (ny - botQuiet) / (1 - topQuiet - botQuiet);
      const fall = Math.exp(-fy * (4.5 - 3 * e));
      const bin = fy * 40;
      const harm = Math.pow(Math.max(0, Math.cos((bin / f0) * Math.PI * 2)), 6);
      const noise = N.fbm(x * 0.09, y * 0.09, seed + 1);
      let i = e * voiced * (fall * (0.4 + 0.6 * harm) + 0.18 * noise) * 1.35;
      i += 0.1 * noise;
      const lvl = Math.min(6, Math.floor(N.cl(i) * 6.999));
      if (lvl > 0) {
        g.fillStyle = pal[lvl];
        g.fillRect(x * s, y * s, s, s);
      }
    }
  }
  grid(g, W, H, s * 12, 0.07);
  g.fillStyle = "rgba(255,255,255,.14)";
  for (let x = s * 12; x < W; x += s * 12) g.fillRect(x, H - 34 - 4, 1, 4);
};

const drawField = (
  g: CanvasRenderingContext2D,
  c: HTMLCanvasElement,
  dpr: number,
  W: number,
  H: number,
  seed: number,
) => {
  const s = 3;
  const cols = Math.ceil(W / s);
  const rows = Math.ceil(H / s);
  const pal = [
    "#06060A",
    "#0A1465",
    "#1327B8",
    "#2140FF",
    "#5C76FF",
    "#9DB0FF",
    "#E4E9FF",
  ];
  g.fillStyle = pal[0];
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const nx = x / cols;
      const ny = y / rows;
      const base = N.fbm(x * 0.012, y * 0.006, seed);
      const streak = 0.45 + 0.55 * N.vn(x * 0.6, y * 0.01, seed + 9);
      const vstreak = 0.6 + 0.4 * N.vn(x * 0.02, y * 0.5, seed + 3);
      const b1 = Math.exp(
        -((nx - 0.72) ** 2 * 1.2 + (ny - 0.3) ** 2 * 0.8) * 6,
      );
      const b2 = Math.exp(-((nx - 0.22) ** 2 * 1.4 + (ny - 0.78) ** 2) * 8);
      const i = (base * 0.5 + b1 * 0.8 + b2 * 0.45) * streak * vstreak;
      const lvl = Math.min(6, Math.floor(N.cl(i) * 6.999));
      if (lvl > 0) {
        g.fillStyle = pal[lvl];
        g.fillRect(x * s, y * s, s, s);
      }
    }
  bands(g, c, dpr, W, H, s, pal[0], [
    [0.12, 2, 6, 0.05],
    [0.14, 1, -10, 0],
    [0.47, 3, 14, 0.08],
    [0.5, 1, -4, 0],
    [0.78, 2, -12, 0.05],
    [0.8, 1, 8, 0],
  ]);
  grid(g, W, H, s * 16, 0.06);
  g.strokeStyle = "rgba(255,255,255,.22)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, Math.round(H * 0.5) + 0.5);
  g.lineTo(W, Math.round(H * 0.5) + 0.5);
  g.stroke();
};

const drawPro = (
  g: CanvasRenderingContext2D,
  c: HTMLCanvasElement,
  dpr: number,
  W: number,
  H: number,
  seed: number,
) => {
  const s = 3;
  const cols = Math.ceil(W / s);
  const rows = Math.ceil(H / s);
  const pal = [
    "#2140FF",
    "#1A2BD9",
    "#2140FF",
    "#3A57FF",
    "#6F87FF",
    "#A9B8FF",
    "#EEF1FF",
  ];
  g.fillStyle = pal[0];
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const nx = x / cols;
      const ny = y / rows;
      const streak = 0.5 + 0.5 * N.vn(x * 0.7, y * 0.015, seed + 9);
      const col = N.vn(x * 0.35, 0, seed + 2);
      const b = Math.exp(-((nx - 0.78) ** 2 * 1.2 + (ny - 0.3) ** 2 * 0.6) * 4);
      const i =
        (0.28 + b * 1.1 + 0.22 * N.fbm(x * 0.03, y * 0.03, seed)) *
        streak *
        (0.65 + 0.35 * col) *
        Math.min(1, nx * 1.6 + 0.1);
      const lvl = Math.min(6, Math.floor(N.cl(i) * 6.999));
      if (lvl > 0) {
        g.fillStyle = pal[lvl];
        g.fillRect(x * s, y * s, s, s);
      }
    }
  bands(g, c, dpr, W, H, s, pal[0], [
    [0.2, 2, 8, 0.08],
    [0.58, 3, -10, 0.06],
    [0.6, 1, 6, 0],
    [0.86, 2, 12, 0.1],
  ]);
  grid(g, W, H, s * 12, 0.12);
  const sh = g.createLinearGradient(0, 0, W, H);
  sh.addColorStop(0, "rgba(255,255,255,0)");
  sh.addColorStop(0.45, "rgba(255,255,255,.14)");
  sh.addColorStop(0.5, "rgba(255,255,255,.22)");
  sh.addColorStop(0.55, "rgba(255,255,255,.1)");
  sh.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = sh;
  g.fillRect(0, 0, W, H);
};

const paint = (
  c: HTMLCanvasElement,
  mode: SpectralMode,
  seed: number,
  energy?: number[],
) => {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = c.clientWidth;
  const H = c.clientHeight;
  if (!W || !H) return;
  c.width = W * dpr;
  c.height = H * dpr;
  const g = c.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (mode === "spec") drawSpec(g, W, H, seed, energy);
  else if (mode === "pro") drawPro(g, c, dpr, W, H, seed);
  else drawField(g, c, dpr, W, H, seed);
};

export const SpectralCanvas: React.FC<SpectralCanvasProps> = ({
  mode,
  seed = 3,
  energy,
  animateMs,
  className = "",
  style,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  // Stable key so a new array with the same numbers does not repaint.
  const energyKey = energy ? energy.map((v) => v.toFixed(3)).join(",") : "";

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const values = energyKey ? energyKey.split(",").map(Number) : undefined;
    let tick = 0;
    const draw = () => paint(c, mode, seed + tick * 0.001, values);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer =
      animateMs && !reduceMotion
        ? window.setInterval(() => {
            tick += 1;
            draw();
          }, animateMs)
        : undefined;
    return () => {
      ro.disconnect();
      if (timer) window.clearInterval(timer);
    };
  }, [mode, seed, energyKey, animateMs]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`block ${className}`}
      style={style}
    />
  );
};
