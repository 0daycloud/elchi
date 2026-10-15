import React from "react";
import { useTranslation } from "react-i18next";
import type { ElchiProStatus } from "@/bindings";
import { daysLeft } from "@/hooks/useElchiPro";
import { SpectralCanvas } from "../ui/SpectralCanvas";

/**
 * The one upgrade offer on Home: a blue card at the end of the feed, for the
 * trial (days left) and once it has ended (free, on Duyu-small).
 */
export const UpsellCard: React.FC<{
  status: ElchiProStatus;
  onUpgrade: () => void;
}> = ({ status, onUpgrade }) => {
  const { t, i18n } = useTranslation();
  const trial = status.plan === "trial";
  const days = daysLeft(status.trial_ends_at) ?? 0;
  const price = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "TRY",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(status.price_try_monthly);
  const terms = [
    t("home.upsell.price", { price }),
    ...(status.free_months > 0
      ? [t("home.upsell.freeMonths", { count: status.free_months })]
      : []),
  ].join(" · ");

  return (
    <section
      aria-label={t("home.upsell.label")}
      className="blue-zone relative mt-3.5 rounded-[10px] overflow-hidden px-6 py-[22px] flex flex-wrap items-center gap-x-6 gap-y-4"
    >
      <SpectralCanvas
        mode="pro"
        seed={11}
        className="absolute right-0 inset-y-0 w-[360px] max-w-[55%] h-full"
      />
      <div
        aria-hidden="true"
        className="absolute right-0 inset-y-0 w-[360px] max-w-[55%] bg-[linear-gradient(90deg,#2140FF_0,rgba(33,64,255,0)_45%)]"
      />
      <div className="relative flex-1 min-w-[240px] flex flex-col gap-1.5">
        <span className="font-mono text-[10px] tracking-[0.12em] uppercase opacity-80">
          {trial
            ? t("home.upsell.trialLabel", { count: days })
            : t("home.upsell.freeLabel")}
        </span>
        <span className="text-[17px] leading-[1.3] tracking-[-0.01em] [text-wrap:pretty]">
          {trial ? t("home.upsell.trialText") : t("home.upsell.freeTitle")}
        </span>
        {!trial && (
          <span className="text-[13px] leading-[1.4] opacity-80">
            {t("home.upsell.freeText")}
          </span>
        )}
        {/* On flat blue, left of the texture, so it stays legible. */}
        <span className="mt-1 font-mono text-[11px] tracking-[0.04em] uppercase opacity-85">
          {terms}
        </span>
      </div>
      <div className="relative ms-auto">
        <button
          type="button"
          onClick={onUpgrade}
          className="chrome-cta px-3.5 py-[9px] text-[13px] leading-none whitespace-nowrap cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-accent"
        >
          {t("home.upsell.cta")}
        </button>
      </div>
    </section>
  );
};
