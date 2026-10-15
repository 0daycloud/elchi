import React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import ElchiLogo from "../icons/ElchiLogo";
import { SpectralCanvas } from "../ui/SpectralCanvas";
import "./onboarding.css";

interface OnboardingShellProps {
  /** Mono label above the title, e.g. "Tur · 2 / 3". */
  stepLabel: string;
  title: string;
  body: string;
  /** Field texture seed: each screen gets its own pattern. */
  seed: number;
  /** Changing it replays the title's fade-in (e.g. on success). */
  titleKey?: string;
  /** Vertically center the content column (permissions, tour 1–2). */
  centered?: boolean;
  footer: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The one onboarding layout (design 3d): a living blue field on the left with
 * the step and its headline, the step's content on the right, and a bottom
 * row for progress and navigation.
 */
export const OnboardingShell: React.FC<OnboardingShellProps> = ({
  stepLabel,
  title,
  body,
  seed,
  titleKey,
  centered = false,
  footer,
  children,
}) => (
  <div className="h-screen w-screen flex overflow-hidden bg-background">
    <aside className="onb-field-edge relative w-[clamp(260px,36vw,340px)] shrink-0 overflow-hidden bg-[#06060a] text-white">
      <SpectralCanvas
        mode="field"
        seed={seed}
        animateMs={1000}
        className="absolute inset-0 w-full h-full"
      />
      {/* Darken the top for the logo and the bottom for the headline. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg,rgba(5,5,6,.45),rgba(5,5,6,0) 30%,rgba(5,5,6,0) 50%,rgba(5,5,6,.82))",
        }}
      />
      <div className="relative h-full flex flex-col justify-between px-7 pt-7 pb-[26px]">
        <ElchiLogo size={14} color="#ffffff" />
        <div className="flex flex-col gap-3.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">
            {stepLabel}
          </span>
          <h1
            key={titleKey ?? title}
            className="font-sans font-light text-[clamp(32px,4.6vw,40px)] leading-[1.05] tracking-[-0.03em] [text-wrap:balance] motion-safe:animate-[fadeIn_300ms_ease-out]"
          >
            {title}
          </h1>
          <p className="text-[13px] leading-[1.55] text-white/70 [text-wrap:pretty]">
            {body}
          </p>
        </div>
      </div>
    </aside>

    {/* Centered steps keep content and navigation together, as in the
        design; the practice step lets its panel fill the height instead. */}
    <main
      className={`onb-pane flex-1 min-w-0 flex flex-col px-10 pt-10 pb-9 overflow-y-auto ${
        centered ? "justify-center gap-6" : "gap-5"
      }`}
    >
      <div className={`flex flex-col ${centered ? "" : "flex-1 min-h-0"}`}>
        {children}
      </div>
      <div className="shrink-0 flex items-center justify-between gap-4">
        {footer}
      </div>
    </main>
  </div>
);

/** Short dashes for progress; `on` marks which ones are lit. */
export const ProgressDashes: React.FC<{
  on: boolean[];
  label: string;
  /** Present as a step progress bar (the tour) rather than a status. */
  step?: number;
}> = ({ on, label, step }) => (
  <span
    className="flex gap-[5px]"
    role={step !== undefined ? "progressbar" : "img"}
    aria-label={label}
    aria-valuemin={step !== undefined ? 1 : undefined}
    aria-valuemax={step !== undefined ? on.length : undefined}
    aria-valuenow={step}
  >
    {on.map((lit, i) => (
      <span
        key={i}
        className={`w-[18px] h-0.5 transition-colors duration-300 ${
          lit ? "bg-accent" : "bg-[var(--track-off)]"
        }`}
      />
    ))}
  </span>
);

/** Mono text button: "← Geri", "Şimdilik atla". */
export const GhostButton: React.FC<{
  onClick: () => void;
  back?: boolean;
  children: React.ReactNode;
}> = ({ onClick, back, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)] hover:text-text transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
  >
    {back && <ArrowLeft className="w-3 h-3" aria-hidden="true" />}
    {children}
  </button>
);

/** The primary chrome pill, with a trailing arrow. */
export const PrimaryButton: React.FC<{
  onClick: () => void;
  arrow?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, arrow = true, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="chrome-cta inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-[9px] text-[13px] leading-none disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
  >
    {children}
    {arrow && <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />}
  </button>
);

/** The dictation shortcut as steel keycaps joined by "+". */
export const ShortcutKeys: React.FC<{
  keys: string[];
  size?: "md" | "lg";
}> = ({ keys, size = "md" }) => (
  <span className="inline-flex flex-wrap items-center gap-2">
    {keys.map((k, i) => (
      <React.Fragment key={`${k}-${i}`}>
        {i > 0 && (
          <span
            aria-hidden="true"
            className="font-mono text-xs text-[var(--text-faint)]"
          >
            +
          </span>
        )}
        <kbd
          lang="en"
          className={`steel-chip font-mono uppercase tracking-[0.06em] ${
            size === "lg"
              ? "px-3.5 py-[9px] rounded-lg text-xs"
              : "px-3 py-[7px] rounded-[7px] text-[11px]"
          }`}
        >
          {k}
        </kbd>
      </React.Fragment>
    ))}
  </span>
);
