import React from "react";
import { useTranslation } from "react-i18next";
import type { DictationStats } from "@/bindings";
import { Kbd } from "../ui/Kbd";
import { SpectralCanvas } from "../ui/SpectralCanvas";

/** Thin bracket marks in the hero's corners, like a viewfinder. */
const Corners: React.FC = () => {
  const base = "absolute size-[10px] border-white/35";
  return (
    <>
      <span
        aria-hidden="true"
        className={`${base} left-2.5 top-2.5 border-l border-t`}
      />
      <span
        aria-hidden="true"
        className={`${base} right-2.5 top-2.5 border-r border-t`}
      />
      <span
        aria-hidden="true"
        className={`${base} left-2.5 bottom-2.5 border-l border-b`}
      />
      <span
        aria-hidden="true"
        className={`${base} right-2.5 bottom-2.5 border-r border-b`}
      />
    </>
  );
};

const mono = "font-mono text-[10px] tracking-[0.1em] uppercase";

/** The speaking speed and how it compares with typing, when known. */
const useSpeed = (stats: DictationStats) => {
  const { t, i18n } = useTranslation();
  const wpm = stats.speaking_wpm;
  if (!wpm) return [] as string[];
  const out = [t("home.hero.wpm", { n: Math.round(wpm) })];
  if (wpm > stats.typing_wpm)
    out.push(
      t("home.hero.faster", {
        x: new Intl.NumberFormat(i18n.language, {
          maximumFractionDigits: 1,
        }).format(wpm / stats.typing_wpm),
      }),
    );
  return out;
};

/**
 * This week at the top of Home. Dark: a spectrogram whose loudness follows
 * the words dictated each of the last seven days, a day under each stretch.
 * Light: the total-blue zone with the speed and the streak along the bottom.
 */
export const WeekHero: React.FC<{ stats: DictationStats; dark: boolean }> = ({
  stats,
  dark,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const speed = useSpeed(stats);
  const max = Math.max(1, ...stats.days.map((d) => d.words));
  // A gentle curve so a light day still shows as speech next to a busy one.
  const energy = stats.days.map((d) => Math.pow(d.words / max, 0.7));
  const total = new Intl.NumberFormat(lang).format(stats.week_words);

  const headline = (
    <div className="absolute z-[1] left-[22px] top-[18px] flex flex-col gap-1.5 text-white">
      <span className={`${mono} ${dark ? "text-white/45" : "text-white/70"}`}>
        {t("home.hero.week")}
      </span>
      <span className="font-light text-[40px] leading-none tracking-[-0.03em] whitespace-nowrap">
        {total}{" "}
        <span
          className={`text-[14px] tracking-normal ${dark ? "text-white/50" : "text-white/70"}`}
        >
          {t("home.hero.unit", { count: stats.week_words })}
        </span>
      </span>
    </div>
  );

  if (!dark)
    return (
      <section
        aria-label={t("home.hero.week")}
        className="blue-zone relative h-[200px] rounded-[10px] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,.35),inset_0_-1px_0_rgba(0,0,0,.3),0_20px_40px_rgba(33,64,255,.2)]"
      >
        <SpectralCanvas
          mode="pro"
          seed={5}
          className="absolute right-0 inset-y-0 w-[60%] h-full"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,#2140FF_35%,rgba(33,64,255,0)_75%)]"
        />
        {headline}
        <div
          className={`absolute z-[1] left-[22px] right-[22px] bottom-4 flex flex-wrap gap-x-[18px] gap-y-1 ${mono} text-white/75`}
        >
          {speed.map((s) => (
            <span key={s}>{s}</span>
          ))}
          {stats.streak_days > 1 && (
            <span>{t("home.hero.streak", { count: stats.streak_days })}</span>
          )}
        </div>
      </section>
    );

  return (
    <section
      aria-label={t("home.hero.week")}
      className="relative h-[200px] rounded-[10px] border border-white/10 bg-[#06060A] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,.14),0_0_0_1px_rgba(0,0,0,.6)]"
    >
      <SpectralCanvas
        mode="spec"
        seed={3}
        energy={energy}
        className="absolute inset-0 w-full h-full"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-16 bg-[linear-gradient(180deg,rgba(6,6,10,.92),rgba(6,6,10,0))]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[34px] bg-[#06060A] border-t border-white/[0.08]"
      />
      <Corners />
      {headline}
      {speed.length > 0 && (
        <div
          className={`absolute z-[1] right-5 top-4 ${mono} text-white/45 text-end`}
        >
          {speed.join(" · ")}
        </div>
      )}
      <div
        aria-hidden="true"
        className={`absolute z-[1] left-5 right-5 bottom-[11px] flex justify-between ${mono} text-white/45`}
      >
        {stats.days.map((d, i) =>
          i === stats.days.length - 1 ? (
            <span key={d.day} className="text-accent-soft">
              {t("home.today")}
            </span>
          ) : (
            <span key={d.day}>
              {new Date(`${d.day}T12:00:00`).toLocaleDateString(lang, {
                weekday: "short",
              })}
            </span>
          ),
        )}
      </div>
    </section>
  );
};

/** macOS modifier symbols, so ⌥ reads as on the keyboard. */
const MAC_SYMBOLS: Record<string, string> = {
  option: "⌥",
  command: "⌘",
  shift: "⇧",
  ctrl: "⌃",
  control: "⌃",
};

/**
 * Home before the first dictation: the shortcut as keycaps over a faint
 * spectrogram (dark) or the blue zone (light).
 */
export const EmptyHero: React.FC<{
  keys: string[];
  mac: boolean;
  dark: boolean;
}> = ({ keys, mac, dark }) => {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("home.empty.title")}
      className={`relative h-[200px] rounded-[10px] overflow-hidden ${
        dark
          ? "border border-white/10 bg-[#06060A] shadow-[inset_0_1px_0_rgba(255,255,255,.14)]"
          : "blue-zone"
      }`}
    >
      <SpectralCanvas
        mode={dark ? "spec" : "pro"}
        seed={7}
        className={`absolute inset-0 w-full h-full ${dark ? "opacity-35" : "opacity-60"}`}
      />
      {!dark && (
        // Flat blue behind the words so they read over the texture.
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(ellipse_55%_60%_at_center,#2140FF_45%,rgba(33,64,255,0)_100%)]"
        />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3.5 text-center px-[60px] max-[720px]:px-6 text-white">
        {keys.length > 0 && (
          <div className="flex items-center gap-2">
            {keys.map((k, i) => (
              <React.Fragment key={`${k}-${i}`}>
                {i > 0 && (
                  <span
                    aria-hidden="true"
                    className="font-mono text-[12px] text-white/40"
                  >
                    +
                  </span>
                )}
                {/* Key names are English: upper-cased here, not by the
                    Turkish locale, so "Option" never reads "OPTİON". */}
                <Kbd className="!px-3 !py-[7px] !rounded-[7px] !text-[11px] !tracking-[0.06em] !normal-case">
                  {(mac && MAC_SYMBOLS[k.toLowerCase()]
                    ? `${MAC_SYMBOLS[k.toLowerCase()]} ${k}`
                    : k
                  ).toLocaleUpperCase("en")}
                </Kbd>
              </React.Fragment>
            ))}
          </div>
        )}
        <span className="font-light text-[22px] leading-[1.2] tracking-[-0.02em]">
          {t("home.empty.title")}
        </span>
        <span
          className={`text-[13px] leading-[1.5] [text-wrap:pretty] ${dark ? "text-white/60" : "text-white/80"}`}
        >
          {t("home.empty.body")}
        </span>
      </div>
    </section>
  );
};
