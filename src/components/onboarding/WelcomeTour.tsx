import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Languages,
  MousePointerClick,
  Sparkles,
} from "lucide-react";
import { events } from "@/bindings";
import { useSettingsStore } from "@/stores/settingsStore";
import { useOsType } from "@/hooks/useOsType";
import { formatKeyCombination } from "@/lib/utils/keyboard";
import ElchiRosette from "../icons/ElchiRosette";

interface WelcomeTourProps {
  onDone: () => void;
}

const STEPS = 3;

/** One key of the dictation shortcut, drawn as a keycap. */
const Keycap: React.FC<{ label: string; large?: boolean }> = ({
  label,
  large,
}) => (
  <kbd
    className={`inline-flex items-center justify-center rounded-lg border border-logo-primary/40 border-b-[3px] bg-background font-mono font-medium text-logo-primary shadow-sm ${
      large ? "min-w-14 h-12 px-4 text-lg" : "min-w-8 h-7 px-2 text-sm"
    }`}
  >
    {label}
  </kbd>
);

const Shortcut: React.FC<{ keys: string[]; large?: boolean }> = ({
  keys,
  large,
}) => (
  <span className="inline-flex items-center gap-1.5 align-middle">
    {keys.map((k, i) => (
      <React.Fragment key={`${k}-${i}`}>
        {i > 0 && <span className="text-text/50">+</span>}
        <Keycap label={k} large={large} />
      </React.Fragment>
    ))}
  </span>
);

/** A small window whose text field fills in, as if dictated. */
const TypingDemo: React.FC<{ text: string }> = ({ text }) => {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setShown(text.length);
      return;
    }
    let i = 0;
    let pause = 0;
    const id = window.setInterval(() => {
      if (i < text.length) {
        // Words land a few characters at a time, like a paste in chunks.
        i = Math.min(text.length, i + 3);
        setShown(i);
      } else if (++pause > 25) {
        i = 0;
        pause = 0;
        setShown(0);
      }
    }, 70);
    return () => window.clearInterval(id);
  }, [text]);

  return (
    <div
      aria-hidden="true"
      className="w-full rounded-xl border border-mid-gray/30 bg-background shadow-sm overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-mid-gray/20">
        <span className="w-2.5 h-2.5 rounded-full bg-mid-gray/40" />
        <span className="w-2.5 h-2.5 rounded-full bg-mid-gray/40" />
        <span className="w-2.5 h-2.5 rounded-full bg-mid-gray/40" />
      </div>
      <div className="p-4 min-h-20 text-left text-[15px] leading-relaxed">
        {text.slice(0, shown)}
        <span className="inline-block w-0.5 h-5 -mb-1 ml-0.5 bg-logo-primary motion-safe:animate-pulse" />
      </div>
    </div>
  );
};

/**
 * First-run tour, after the permissions: what Elchi does and why it is worth
 * it, how to dictate with the user's own shortcut, and a practice box to try
 * it once before using it anywhere.
 */
const WelcomeTour: React.FC<WelcomeTourProps> = ({ onDone }) => {
  const { t } = useTranslation();
  const osType = useOsType();
  const settings = useSettingsStore((s) => s.settings);
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState("");
  const practiceRef = useRef<HTMLTextAreaElement>(null);

  const keys = useMemo(() => {
    const binding = settings?.bindings?.transcribe?.current_binding ?? "";
    const label = formatKeyCombination(binding, osType);
    return label ? label.split(" + ") : [];
  }, [settings, osType]);
  const activation = settings?.shortcut_activation ?? "hold_or_toggle";

  // A dictation made during the practice step lands in the practice box (it
  // is focused, so Elchi pastes into it); the history event is a fallback for
  // when pasting into our own window doesn't go through.
  useEffect(() => {
    if (step !== 2) return;
    practiceRef.current?.focus();
    const unlisten = events.historyUpdatePayload.listen((e) => {
      const p = e.payload;
      if (p.action === "added" && p.entry.transcription_text.trim()) {
        setTried((cur) => cur || p.entry.transcription_text.trim());
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [step]);

  const success = tried.trim().length > 0;
  const next = () => (step < STEPS - 1 ? setStep(step + 1) : onDone());

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center px-6 py-8 overflow-y-auto">
      <div className="w-full max-w-xl flex flex-col items-center text-center gap-6">
        {/* Progress */}
        <div
          className="flex gap-2"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS}
          aria-valuenow={step + 1}
          aria-label={t("onboarding.tour.progress", {
            step: step + 1,
            total: STEPS,
          })}
        >
          {Array.from({ length: STEPS }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step
                  ? "w-8 bg-logo-primary"
                  : i < step
                    ? "w-4 bg-logo-primary/60"
                    : "w-4 bg-mid-gray/30"
              }`}
            />
          ))}
        </div>

        <div
          key={step}
          className="w-full flex flex-col items-center gap-6 motion-safe:animate-[fadeIn_300ms_ease-out]"
        >
          {step === 0 && (
            <>
              <div className="motion-safe:animate-[spin_40s_linear_infinite]">
                <ElchiRosette size={84} />
              </div>
              <div className="space-y-3">
                <h1 className="font-display text-3xl font-bold text-logo-primary">
                  {t("onboarding.tour.welcome.title")}
                </h1>
                <p className="text-base text-text/80 max-w-md mx-auto">
                  {t("onboarding.tour.welcome.lede")}
                </p>
              </div>
              <ul className="w-full grid gap-3 text-left">
                {[
                  {
                    icon: MousePointerClick,
                    title: t("onboarding.tour.welcome.anywhere.title"),
                    body: t("onboarding.tour.welcome.anywhere.body"),
                  },
                  {
                    icon: Languages,
                    title: t("onboarding.tour.welcome.languages.title"),
                    body: t("onboarding.tour.welcome.languages.body"),
                  },
                  {
                    icon: Sparkles,
                    title: t("onboarding.tour.welcome.pro.title"),
                    body: t("onboarding.tour.welcome.pro.body"),
                  },
                ].map(({ icon: Icon, title, body }) => (
                  <li
                    key={title}
                    className="flex gap-3 items-start rounded-xl border border-mid-gray/25 bg-logo-primary/5 p-4"
                  >
                    <span className="shrink-0 w-9 h-9 rounded-lg bg-logo-primary/15 text-logo-primary flex items-center justify-center">
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block font-semibold">{title}</span>
                      <span className="block text-sm text-text/75">{body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {step === 1 && (
            <>
              <div className="space-y-3">
                <h1 className="font-display text-3xl font-bold text-logo-primary">
                  {t("onboarding.tour.how.title")}
                </h1>
                {keys.length > 0 && (
                  <div className="flex justify-center pt-1">
                    <Shortcut keys={keys} large />
                  </div>
                )}
              </div>
              <ol className="w-full grid sm:grid-cols-3 gap-3 text-left">
                {[
                  t("onboarding.tour.how.step1"),
                  activation === "toggle"
                    ? t("onboarding.tour.how.step2Toggle")
                    : t("onboarding.tour.how.step2Hold"),
                  activation === "toggle"
                    ? t("onboarding.tour.how.step3Toggle")
                    : t("onboarding.tour.how.step3Hold"),
                ].map((text, i) => (
                  <li
                    key={i}
                    className="rounded-xl border border-mid-gray/25 p-4 space-y-2"
                  >
                    <span className="inline-flex w-7 h-7 rounded-full bg-logo-primary text-background font-mono text-sm items-center justify-center">
                      {i + 1}
                    </span>
                    <p className="text-sm">{text}</p>
                  </li>
                ))}
              </ol>
              <TypingDemo text={t("onboarding.tour.how.demo")} />
              {activation === "hold_or_toggle" && (
                <p className="text-sm text-text/70">
                  {t("onboarding.tour.how.longer")}
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-3">
                <h1 className="font-display text-3xl font-bold text-logo-primary">
                  {success
                    ? t("onboarding.tour.try.successTitle")
                    : t("onboarding.tour.try.title")}
                </h1>
                <p className="text-base text-text/80">
                  {success ? (
                    t("onboarding.tour.try.successBody")
                  ) : (
                    <>
                      {activation === "toggle"
                        ? t("onboarding.tour.try.instructionToggle")
                        : t("onboarding.tour.try.instructionHold")}{" "}
                      {keys.length > 0 && <Shortcut keys={keys} />}
                    </>
                  )}
                </p>
              </div>
              {!success && (
                <blockquote className="w-full rounded-xl bg-logo-primary/10 p-4 font-serif italic text-xl text-logo-primary">
                  “{t("onboarding.tour.try.phrase")}”
                </blockquote>
              )}
              <label className="w-full text-left space-y-2">
                <span className="text-sm text-text/70">
                  {t("onboarding.tour.try.boxLabel")}
                </span>
                <div className="relative">
                  <textarea
                    ref={practiceRef}
                    value={tried}
                    onChange={(e) => setTried(e.target.value)}
                    rows={3}
                    placeholder={t("onboarding.tour.try.placeholder")}
                    className={`w-full rounded-xl border-2 bg-background p-4 text-[15px] leading-relaxed resize-none focus:outline-none transition-colors ${
                      success
                        ? "border-logo-primary"
                        : "border-mid-gray/40 focus:border-logo-primary/70"
                    }`}
                  />
                  {success && (
                    <span className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-logo-primary text-background flex items-center justify-center motion-safe:animate-[fadeIn_300ms_ease-out]">
                      <Check className="w-5 h-5" aria-hidden="true" />
                    </span>
                  )}
                </div>
              </label>
              {success && (
                <p className="text-sm text-text/75">
                  {t("onboarding.tour.try.anywhere")}
                </p>
              )}
            </>
          )}
        </div>

        {/* Navigation */}
        <div className="w-full flex items-center justify-between pt-2">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="inline-flex items-center gap-1.5 text-sm text-text/70 hover:text-text px-2 py-1 rounded-md"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              {t("onboarding.tour.back")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {step === 2 && !success && (
              <button
                type="button"
                onClick={onDone}
                className="text-sm text-text/70 hover:text-text px-2 py-1 rounded-md"
              >
                {t("onboarding.tour.skip")}
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-2 rounded-lg bg-logo-primary px-5 py-2.5 font-medium text-background hover:bg-logo-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary/50 focus-visible:ring-offset-2"
            >
              {step === 2
                ? t("onboarding.tour.start")
                : t("onboarding.tour.next")}
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WelcomeTour;
