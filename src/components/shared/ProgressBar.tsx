import React from "react";
import { useTranslation } from "react-i18next";

export interface ProgressData {
  id: string;
  percentage: number;
  speed?: number;
  label?: string;
}

interface DownloadCellsProps {
  /** 0..100. Ignored while `indeterminate`. */
  percentage: number;
  /** Number of square cells across the width. */
  cells?: number;
  /** Cell height in px. */
  height?: number;
  /** Verifying / extracting: no number to show, the whole row breathes. */
  indeterminate?: boolean;
  className?: string;
  /** Accessible name for the progressbar role. */
  label?: string;
}

/**
 * Download progress as a row of flat cells (style sheet: "texture only via
 * cells"): filled cells in the accent blue, the cell being filled a lighter
 * blue, the rest off.
 */
export const DownloadCells: React.FC<DownloadCellsProps> = ({
  percentage,
  cells = 40,
  height = 8,
  indeterminate = false,
  className = "",
  label,
}) => {
  const pct = Math.max(0, Math.min(100, percentage));
  const filled = Math.floor((pct / 100) * cells);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      className={`flex gap-[2px] ${indeterminate ? "motion-safe:animate-pulse" : ""} ${className}`}
      style={{ height }}
    >
      {Array.from({ length: cells }, (_, i) => {
        const color = indeterminate
          ? "var(--color-accent)"
          : i < filled
            ? "var(--color-accent)"
            : i === filled && pct < 100
              ? "#5C76FF"
              : "var(--cell-off)";
        return (
          <span
            key={i}
            aria-hidden="true"
            className="flex-1"
            style={{ background: color }}
          />
        );
      })}
    </div>
  );
};

interface ProgressBarProps {
  progress: ProgressData[];
  className?: string;
  size?: "small" | "medium" | "large";
  showSpeed?: boolean;
  showLabel?: boolean;
}

/** Compact inline progress (footer, update install) built from cells. */
const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  className = "",
  size = "medium",
  showSpeed = false,
  showLabel = false,
}) => {
  const { t } = useTranslation();
  const sizes = {
    small: { width: 64, cells: 12, height: 4 },
    medium: { width: 80, cells: 16, height: 6 },
    large: { width: 96, cells: 20, height: 6 },
  }[size];

  if (progress.length === 0) {
    return null;
  }

  if (progress.length === 1) {
    const item = progress[0];
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <div className="shrink-0" style={{ width: sizes.width }}>
          <DownloadCells
            percentage={item.percentage}
            cells={sizes.cells}
            height={sizes.height}
            label={item.label}
          />
        </div>
        {(showSpeed || showLabel) && (
          <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text/60 tabular-nums min-w-fit">
            {showLabel && item.label && (
              <span className="me-2">{item.label}</span>
            )}
            {showSpeed && item.speed !== undefined && item.speed > 0 ? (
              <span>
                {t("modelSelector.downloadSpeed", {
                  speed: item.speed.toFixed(1),
                })}
              </span>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  // Several downloads: one short cell row each.
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex gap-1.5">
        {progress.map((item) => (
          <div key={item.id} title={item.label || `${item.percentage}%`}>
            <DownloadCells
              percentage={item.percentage}
              cells={5}
              height={sizes.height}
              label={item.label}
              className="w-4"
            />
          </div>
        ))}
      </div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text/60 min-w-fit">
        {t("modelSelector.downloadingMultiple", { count: progress.length })}
      </div>
    </div>
  );
};

export default ProgressBar;
