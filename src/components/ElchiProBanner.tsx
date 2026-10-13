import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "./ui/Button";
import { daysLeft, useElchiPro } from "@/hooks/useElchiPro";

/**
 * The Duyu Pro call to action above every settings page: a quiet countdown
 * during the trial, and the upgrade offer once it has ended. Dismissing hides
 * it until the app is opened again.
 */
export const ElchiProBanner: React.FC = () => {
  const { t } = useTranslation();
  const { status, upgrade } = useElchiPro();
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState(false);

  if (!status || dismissed) return null;
  const ended = status.plan === "free";
  if (!ended && status.plan !== "trial") return null;

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
      className={`w-full max-w-3xl rounded-xl border p-3 flex flex-wrap items-center gap-3 ${
        ended
          ? "border-logo-primary bg-logo-primary/10"
          : "border-logo-primary/30 bg-logo-primary/5"
      }`}
    >
      <p className="flex-1 min-w-[16rem] text-sm">
        {ended ? (
          <>
            <span className="font-semibold">{t("elchiPro.banner.ended")}</span>{" "}
            {t("elchiPro.banner.endedDetail")}
          </>
        ) : (
          t("elchiPro.banner.trial", {
            count: daysLeft(status.trial_ends_at) ?? 0,
          })
        )}
        {error && (
          <span role="alert" className="block text-red-700 dark:text-red-400">
            {t("elchiPro.upgradeFailed")}
          </span>
        )}
      </p>
      <Button
        size="sm"
        variant={ended ? "primary" : "primary-soft"}
        onClick={onUpgrade}
      >
        {t("elchiPro.cta")}
      </Button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t("elchiPro.banner.dismiss")}
        className="p-1 rounded-md text-text/60 hover:text-text hover:bg-mid-gray/10"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};
