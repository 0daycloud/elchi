import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useElchiPro } from "@/hooks/useElchiPro";
import { SpectralCanvas } from "./ui/SpectralCanvas";

/**
 * The trial-ended banner above the settings pages (design frame 2d): one
 * total-blue card with the Pro pixel texture fading in from the right.
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
      className="blue-zone relative overflow-hidden rounded-[10px] grid grid-cols-[1fr_auto_auto] items-center gap-3 ps-4 pe-2.5 py-3.5"
    >
      <SpectralCanvas
        mode="pro"
        seed={7}
        className="absolute inset-y-px end-px w-[200px] h-[calc(100%-2px)] rounded-e-[9px] pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-px end-px w-[200px] pointer-events-none bg-[linear-gradient(90deg,#2140ff_0,rgba(33,64,255,0)_50%)] rtl:-scale-x-100"
      />
      <div className="relative flex flex-col gap-[3px] min-w-0">
        <span className="text-[13px] font-medium">
          {t("elchiPro.banner.ended")}
        </span>
        <span className="text-[11.5px] text-white/80">
          {t("elchiPro.banner.endedDetail")}
        </span>
        {error && (
          <span role="alert" className="text-[11.5px] text-white">
            {t("elchiPro.upgradeFailed")}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onUpgrade}
        className="chrome-cta relative px-3 py-2 text-[12px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        {t("elchiPro.cta")}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t("elchiPro.banner.dismiss")}
        className="relative p-1 rounded-md text-white/70 hover:text-white hover:bg-white/10 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};
