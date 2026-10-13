import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useElchiPro } from "@/hooks/useElchiPro";

/**
 * The upgrade offer above every settings page once the Duyu Pro trial has
 * ended (during the trial the header's plan badge counts it down).
 * Dismissing hides it until the app is opened again.
 */
export const ElchiProBanner: React.FC = () => {
  const { t } = useTranslation();
  const { status, upgrade } = useElchiPro();
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState(false);

  if (!status || dismissed || status.plan !== "free") return null;

  const onUpgrade = async () => {
    setError(false);
    try {
      await upgrade();
    } catch {
      setError(true);
    }
  };

  return (
    <div
      role="region"
      aria-label={t("elchiPro.card.eyebrow")}
      className="w-full max-w-3xl rounded-2xl bg-surface-warm px-4 py-3 flex flex-wrap items-center gap-3"
    >
      <p className="flex-1 min-w-[16rem] text-sm">
        <span className="font-semibold">{t("elchiPro.banner.ended")}</span>{" "}
        {t("elchiPro.banner.endedDetail")}
        {error && (
          <span role="alert" className="block text-error">
            {t("elchiPro.upgradeFailed")}
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={onUpgrade}
        className="rounded-xl bg-coral px-4 py-2 text-sm font-semibold text-on-coral hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/50"
      >
        {t("elchiPro.cta")}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t("elchiPro.banner.dismiss")}
        className="p-1 rounded-md text-mid-gray hover:text-text hover:bg-mid-gray/10"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};
