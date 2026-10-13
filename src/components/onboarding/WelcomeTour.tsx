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
import ElchiStar from "../icons/ElchiStar";

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
    className={`inline-flex items-center justify-center rounded-xl border-2 border-border bg-surface font-sans font-semibold text-text ${
      large ? "min-w-16 h-14 px-5 text-lg" : "min-w-9 h-8 px-2.5 text-sm"
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
        {i > 0 && <span className="text-mid-gray">+</span>}
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
      className="w-full rounded-2xl border-2 border-surface bg-background overflow-hidden"
    >
      <div className="px-5 py-4 min-h-20 text-left text-base leading-relaxed">
        {text.slice(0, shown)}
        <span className="inline-block w-0.5 h-5 -mb-1 ml-0.5 bg-coral motion-safe:animate-pulse" />
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
      if (p.action !== "added") return;
      const text = (
        p.entry.post_processed_text ?? p.entry.transcription_text
      ).trim();
      if (text) {
        setTried((cur) => cur || text);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [step]);

  const success = tried.trim().length > 0;
  const next = () => (step < STEPS - 1 ? setStep(step + 1) : onDone());

  const panel = [
    {
      title: t("onboarding.tour.welcome.title"),
      body: t("onboarding.tour.welcome.lede"),
    },
    {
      title: t("onboarding.tour.how.title"),
      body: t("onboarding.tour.how.lede"),
    },
    success
      ? {
          title: t("onboarding.tour.try.successTitle"),
          body: t("onboarding.tour.try.successBody"),
        }
      : {
          title: t("onboarding.tour.try.title"),
          body:
            activation === "toggle"
              ? t("onboarding.tour.try.instructionToggle")
              : t("onboarding.tour.try.instructionHold"),
        },
  ][step];

  const features = [
    {
      icon: MousePointerClick,
      title: t("onboarding.tour.welcome.anywhere.title"),
      body: t("onboarding.tour.welcome.anywhere.body"),
      warm: false,
    },
    {
      icon: Languages,
      title: t("onboarding.tour.welcome.languages.title"),
      body: t("onboarding.tour.welcome.languages.body"),
      warm: false,
    },
    {
      icon: Sparkles,
      title: t("onboarding.tour.welcome.pro.title"),
      body: t("onboarding.tour.welcome.pro.body"),
      warm: true,
    },
  ];

  const howSteps = [
    t("onboarding.tour.how.step1"),
    activation === "toggle"
      ? t("onboarding.tour.how.step2Toggle")
      : t("onboarding.tour.how.step2Hold"),
    activation === "toggle"
      ? t("onboarding.tour.how.step3Toggle")
      : t("onboarding.tour.how.step3Hold"),
  ];

  return (
    <div className="h-screen w-screen flex overflow-hidden">
      {/* Teal panel: the step, its headline and the star */}
      <aside className="relative w-[38%] max-w-sm shrink-0 bg-header text-on-header px-9 py-10 flex flex-col gap-5 overflow-hidden">
        <span className="text-xs font-semibold tracking-widest text-on-header-muted">
          {t("onboarding.tour.progress", { step: step + 1, total: STEPS })}
        </span>
        <h1
          key={`t${step}${success}`}
          className="font-display text-4xl font-bold leading-[1.08] tracking-tight motion-safe:animate-[fadeIn_300ms_ease-out]"
        >
          {panel.title}
        </h1>
        <p className="text-base leading-relaxed text-on-header-muted">
          {panel.body}
        </p>
        <div className="absolute -right-20 -bottom-20 motion-safe:animate-[spin_60s_linear_infinite]">
          <ElchiStar
            size={280}
            color="var(--color-star)"
            eye="var(--color-header)"
          />
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0 flex flex-col px-9 py-10 gap-5 overflow-y-auto">
        <div
          key={step}
          className="flex flex-col gap-4 motion-safe:animate-[fadeIn_300ms_ease-out]"
        >
          {step === 0 && (
            <ul className="flex flex-col gap-3">
              {features.map(({ icon: Icon, title, body, warm }) => (
                <li
                  key={title}
                  className={`flex gap-4 items-start rounded-2xl p-4 ${
                    warm ? "bg-surface-warm" : "bg-surface"
                  }`}
                >
                  <span
                    className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${
                      warm
                        ? "bg-coral text-on-coral"
                        : "bg-logo-primary text-background"
                    }`}
                  >
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-base font-semibold">
                      {title}
                    </span>
                    <span className="block text-sm text-mid-gray mt-0.5">
                      {body}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {step === 1 && (
            <>
              {keys.length > 0 && <Shortcut keys={keys} large />}
              <ol className="flex flex-col gap-3">
                {howSteps.map((text, i) => (
                  <li key={i} className="flex gap-3.5 items-center text-base">
                    <span
                      className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm ${
                        i === 2
                          ? "bg-coral text-on-coral"
                          : "bg-logo-primary text-background"
                      }`}
                    >
                      {i + 1}
                    </span>
                    {text}
                  </li>
                ))}
              </ol>
              <TypingDemo text={t("onboarding.tour.how.demo")} />
              {activation === "hold_or_toggle" && (
                <p className="text-sm text-mid-gray">
                  {t("onboarding.tour.how.longer")}
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {!success && keys.length > 0 && (
                <div>
                  <Shortcut keys={keys} />
                </div>
              )}
              <blockquote className="rounded-2xl bg-surface px-5 py-4 text-lg leading-relaxed text-logo-primary">
                “{t("onboarding.tour.try.phrase")}”
              </blockquote>
              <label className="flex flex-col gap-2">
                <span className="text-sm text-mid-gray">
                  {t("onboarding.tour.try.boxLabel")}
                </span>
                <div className="relative">
                  <textarea
                    ref={practiceRef}
                    value={tried}
                    onChange={(e) => setTried(e.target.value)}
                    rows={3}
                    placeholder={t("onboarding.tour.try.placeholder")}
                    className={`w-full rounded-2xl border-2 bg-background px-5 py-4 text-lg leading-relaxed resize-none focus:outline-none transition-colors ${
                      success
                        ? "border-logo-primary"
                        : "border-border focus:border-logo-primary/70"
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
                <p className="text-sm text-mid-gray">
                  {t("onboarding.tour.try.anywhere")}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex-1" />

        {/* Navigation */}
        <div className="flex items-center justify-between gap-4">
          <div
            className="flex gap-1.5"
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
                  i === step ? "w-7 bg-logo-primary" : "w-3 bg-border"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="inline-flex items-center gap-1.5 text-sm text-mid-gray hover:text-text px-2 py-1 rounded-md"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                {t("onboarding.tour.back")}
              </button>
            )}
            {step === 2 && !success && (
              <button
                type="button"
                onClick={onDone}
                className="text-sm text-mid-gray hover:text-text px-2 py-1 rounded-md"
              >
                {t("onboarding.tour.skip")}
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-2 rounded-xl bg-coral px-6 py-3 font-semibold text-on-coral hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/50 focus-visible:ring-offset-2"
            >
              {step === 2
                ? t("onboarding.tour.start")
                : t("onboarding.tour.next")}
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default WelcomeTour;
