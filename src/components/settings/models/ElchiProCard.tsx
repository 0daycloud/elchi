import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { daysLeft, useElchiPro } from "@/hooks/useElchiPro";

/**
 * Duyu Pro, the cloud model: the 7-day trial, Elchi Pro, or the upgrade
 * offer once the trial is over.
 */
export const ElchiProCard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { status, upgrade, setUsePro } = useElchiPro();
  const [error, setError] = useState<string | null>(null);

  if (!status) return null;

  const price = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "TRY",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(status.price_try_monthly);
  const date = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(
          new Date(iso),
        )
      : "";

  const onUpgrade = async () => {
    setError(null);
    try {
      await upgrade();
    } catch {
      setError(t("elchiPro.upgradeFailed"));
    }
  };

  const plan = status.plan;
  const headline =
    plan === "pro"
      ? t("elchiPro.card.proTitle")
      : plan === "trial"
        ? t("elchiPro.card.trialTitle", {
            count: daysLeft(status.trial_ends_at) ?? 0,
          })
        : plan === "free"
          ? t("elchiPro.card.freeTitle")
          : t("elchiPro.card.title");
  const detail =
    plan === "pro"
      ? t("elchiPro.card.proDetail", { date: date(status.pro_until) })
      : plan === "free"
        ? t("elchiPro.card.freeDetail")
        : t("elchiPro.card.detail");

  return (
    <section
      aria-labelledby="duyu-pro-title"
      className={`rounded-2xl border-2 p-5 space-y-4 ${
        plan === "free" ? "border-coral/60" : "border-logo-primary"
      }`}
    >
      <div className="space-y-1.5">
        <p
          className={`text-xs font-semibold uppercase tracking-widest ${
            plan === "free" ? "text-coral" : "text-logo-primary"
          }`}
        >
          {t("elchiPro.card.eyebrow")}
        </p>
        <h2
          id="duyu-pro-title"
          className="text-2xl font-semibold leading-tight"
        >
          {headline}
        </h2>
        <p className="text-[15px] text-mid-gray">{detail}</p>
      </div>

      {plan !== "pro" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={onUpgrade}
            className="rounded-xl bg-coral px-5 py-3 font-semibold text-on-coral hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/50 focus-visible:ring-offset-2"
          >
            {t("elchiPro.cta")}
          </button>
          <p className="text-sm">
            <span className="font-semibold tabular-nums">
              {t("elchiPro.pricePerMonth", { price })}
            </span>
            <span className="text-mid-gray"> · {t("elchiPro.freeMonth")}</span>
          </p>
        </div>
      )}

      {plan !== "free" && plan !== null && (
        <ToggleSwitch
          checked={status.use_pro}
          onChange={(enabled) => setUsePro(enabled)}
          label={t("elchiPro.card.useCloud")}
          description={t("elchiPro.card.useCloudDescription")}
          descriptionMode="inline"
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </section>
  );
};
