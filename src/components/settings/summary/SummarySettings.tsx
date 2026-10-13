import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { commands, events, type DictationStats } from "@/bindings";
import { daysLeft, useElchiPro } from "@/hooks/useElchiPro";

/** Minutes as "1 sa 30 dk" / "12 dk" (at least a minute once anything was saved). */
const useDuration = () => {
  const { t } = useTranslation();
  return (minutes: number) => {
    const m = Math.max(minutes > 0 ? 1 : 0, Math.round(minutes));
    return m >= 60
      ? t("summary.hoursMinutes", { h: Math.floor(m / 60), m: m % 60 })
      : t("summary.minutes", { m });
  };
};

/** The last seven days as bars, today in coral. */
const WeekBars: React.FC<{ days: DictationStats["days"]; lang: string }> = ({
  days,
  lang,
}) => {
  const max = Math.max(1, ...days.map((d) => d.words));
  return (
    <div className="flex items-end gap-2 h-28" aria-hidden="true">
      {days.map((d, i) => {
        const today = i === days.length - 1;
        const h = d.words === 0 ? 4 : Math.max(8, (d.words / max) * 92);
        return (
          <div key={d.day} className="flex flex-col items-center gap-1.5">
            <div
              className={`w-5 rounded-t-md ${today ? "bg-coral" : "bg-on-header/35"}`}
              style={{ height: h }}
            />
            <span
              className={`text-[11px] ${today ? "text-on-header font-semibold" : "text-on-header-muted"}`}
            >
              {new Date(`${d.day}T12:00:00`).toLocaleDateString(lang, {
                weekday: "narrow",
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const Tile: React.FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div className="rounded-xl border border-border bg-surface p-4 space-y-1">
    <p className="text-xs font-semibold uppercase tracking-widest text-mid-gray">
      {label}
    </p>
    <p className="font-display text-2xl font-bold text-logo-primary">{value}</p>
    {hint && <p className="text-sm text-mid-gray">{hint}</p>}
  </div>
);

/**
 * What Elchi has written this week, and the time it saved: words, a 7-day
 * chart, speaking speed against typing, the streak, and a nudge toward Duyu Pro.
 */
export const SummarySettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { status, upgrade } = useElchiPro();
  const [stats, setStats] = useState<DictationStats | null>(null);
  const duration = useDuration();
  const n = (v: number) => new Intl.NumberFormat(i18n.language).format(v);

  const load = useCallback(() => {
    commands.getDictationStats().then((r) => {
      if (r.status === "ok") setStats(r.data);
    });
  }, []);

  useEffect(() => {
    load();
    const unlisten = events.historyUpdatePayload.listen(load);
    window.addEventListener("focus", load);
    return () => {
      unlisten.then((f) => f());
      window.removeEventListener("focus", load);
    };
  }, [load]);

  if (!stats) return null;

  const empty = stats.total_dictations === 0;
  const saved = duration(stats.week_minutes_saved);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(
        t("summary.shareText", { words: n(stats.week_words), time: saved }),
      );
      toast.success(t("summary.copied"));
    } catch {
      /* the clipboard can be refused; nothing to undo */
    }
  };

  return (
    <div className="max-w-3xl w-full mx-auto space-y-4">
      <section
        aria-labelledby="summary-week"
        className="relative overflow-hidden rounded-2xl bg-header text-on-header p-6"
      >
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="space-y-2">
            <p
              id="summary-week"
              className="text-xs font-semibold uppercase tracking-widest text-on-header-muted"
            >
              {t("summary.eyebrow")}
            </p>
            {empty ? (
              <>
                <h2 className="font-display text-3xl font-bold leading-tight">
                  {t("summary.emptyTitle")}
                </h2>
                <p className="max-w-sm text-on-header-muted">
                  {t("summary.emptyBody")}
                </p>
              </>
            ) : (
              <>
                <h2 className="font-display text-5xl font-bold leading-none tracking-tight">
                  {t("summary.words", {
                    count: stats.week_words,
                    n: n(stats.week_words),
                  })}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="inline-flex rounded-full bg-coral text-on-coral px-3 py-1 text-sm font-semibold">
                    {stats.week_minutes_saved > 0
                      ? t("summary.saved", { time: saved })
                      : t("summary.savedNone")}
                  </p>
                  <button
                    type="button"
                    onClick={share}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium text-on-header hover:bg-on-header/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-on-header"
                  >
                    <Share2 size={15} aria-hidden="true" />
                    {t("summary.share")}
                  </button>
                </div>
              </>
            )}
          </div>
          {!empty && (
            <div className="space-y-2">
              <WeekBars days={stats.days} lang={i18n.language} />
              <p className="sr-only">{t("summary.chart")}</p>
            </div>
          )}
        </div>
      </section>

      {!empty && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Tile
              label={t("summary.today")}
              value={t("summary.words", {
                count: stats.today_words,
                n: n(stats.today_words),
              })}
            />
            <Tile
              label={t("summary.speed")}
              value={
                stats.speaking_wpm
                  ? t("summary.speedValue", {
                      wpm: Math.round(stats.speaking_wpm),
                    })
                  : "—"
              }
              hint={
                stats.speaking_wpm && stats.speaking_wpm > stats.typing_wpm
                  ? t("summary.faster", {
                      x: new Intl.NumberFormat(i18n.language, {
                        maximumFractionDigits: 1,
                      }).format(stats.speaking_wpm / stats.typing_wpm),
                    })
                  : undefined
              }
            />
            <Tile
              label={t("summary.streak")}
              value={t("summary.streakDays", { count: stats.streak_days })}
              hint={t("summary.streakHint")}
            />
          </div>
          <p className="px-1 text-sm text-mid-gray">
            {t("summary.totals", {
              words: n(stats.total_words),
              dictations: n(stats.total_dictations),
              time: duration(stats.total_minutes_saved),
            })}
          </p>
        </>
      )}

      {status?.plan === "free" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-coral/60 p-4">
          <p className="text-[15px] max-w-md">{t("summary.upsellFree")}</p>
          <button
            type="button"
            onClick={() => upgrade().catch(() => undefined)}
            className="rounded-xl bg-coral px-4 py-2.5 font-semibold text-on-coral hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/50"
          >
            {t("elchiPro.cta")}
          </button>
        </div>
      )}
      {status?.plan === "trial" && (
        <p className="px-1 text-sm text-mid-gray">
          {t("summary.upsellTrial", {
            count: daysLeft(status.trial_ends_at) ?? 0,
          })}
        </p>
      )}
    </div>
  );
};
