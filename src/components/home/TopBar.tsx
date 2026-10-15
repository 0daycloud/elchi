import React from "react";
import { useTranslation } from "react-i18next";
import type { DictationStats, ElchiProStatus } from "@/bindings";
import { daysLeft } from "@/hooks/useElchiPro";
import ElchiLogo from "../icons/ElchiLogo";
import type { SidebarSection } from "../Sidebar";
import { useActiveMeeting } from "../meetings/useMeetings";

/**
 * Home's steel top bar: the wordmark, this week in numbers, the engine that
 * is transcribing right now (and the trial's days), and the way to Settings.
 */
export const TopBar: React.FC<{
  stats: DictationStats | null;
  status: ElchiProStatus | null;
  onOpenSettings: (section?: SidebarSection) => void;
  onOpenMeetings?: () => void;
}> = ({ stats, status, onOpenSettings, onOpenMeetings }) => {
  const { t, i18n } = useTranslation();
  const { active: meeting } = useActiveMeeting();
  const n = (v: number) => new Intl.NumberFormat(i18n.language).format(v);
  const duration = (m: number) => {
    const r = Math.max(m > 0 ? 1 : 0, Math.round(m));
    return r >= 60
      ? t("home.bar.hoursMinutes", { h: Math.floor(r / 60), m: r % 60 })
      : t("home.bar.minutes", { m: r });
  };

  const stat = (value: string, label: string, className = "") => (
    <span className={`whitespace-nowrap ${className}`}>
      <span className="text-text">{value}</span> {label}
    </span>
  );

  const engine = !status
    ? null
    : status.cloud_active
      ? status.plan === "trial"
        ? t("elchiPro.badge.trial", {
            count: daysLeft(status.trial_ends_at) ?? 0,
          })
        : t("home.engineCloud")
      : t("home.engineLocal");

  return (
    <header className="steel-bar relative z-10 flex-none h-14 px-7 max-[720px]:px-5 flex items-center gap-5">
      <ElchiLogo size={15} className="flex-none" />
      <div className="flex-1 min-w-0 flex justify-center">
        {stats && stats.week_words > 0 && (
          <div
            className="flex gap-7 max-[760px]:gap-4 min-w-0 overflow-hidden font-mono text-[11px] tracking-[0.06em] uppercase text-[color:var(--text-faint)]"
            aria-label={t("home.hero.week")}
          >
            {stat(
              n(stats.week_words),
              t("home.bar.words", { count: stats.week_words }),
            )}
            {stats.week_minutes_saved > 0 &&
              stat(duration(stats.week_minutes_saved), t("home.bar.saved"))}
            {stats.streak_days > 1 &&
              stat(
                n(stats.streak_days),
                t("home.bar.streak", { count: stats.streak_days }),
                // The first to go when the window is narrow.
                "max-[740px]:hidden",
              )}
          </div>
        )}
      </div>
      <div className="flex-none flex items-center gap-2.5">
        {engine && (
          <button
            type="button"
            onClick={() => onOpenSettings("models")}
            title={t("home.bar.engine")}
            className="steel-chip !rounded-full flex items-center gap-[7px] px-2.5 py-[5px] font-mono text-[10.5px] leading-none tracking-[0.06em] uppercase whitespace-nowrap cursor-pointer hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <span aria-hidden="true" className="dot-accent" />
            {engine}
          </button>
        )}
        {onOpenMeetings && (
          <button
            type="button"
            onClick={onOpenMeetings}
            className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full font-mono text-[10.5px] leading-none tracking-[0.06em] uppercase text-[color:var(--text-faint)] hover:text-text cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {meeting && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse"
              />
            )}
            {meeting ? t("meetings.recordingNow") : t("meetings.title")}
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenSettings()}
          className="px-2.5 py-[5px] rounded-full font-mono text-[10.5px] leading-none tracking-[0.06em] uppercase text-[color:var(--text-faint)] hover:text-text cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {t("home.settings")}
        </button>
      </div>
    </header>
  );
};
