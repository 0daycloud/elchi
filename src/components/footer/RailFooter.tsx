import React from "react";
import { Trans, useTranslation } from "react-i18next";
import ModelSelector from "../model-selector";
import { useUpdater } from "../update-checker";
import { SELF_UPDATE_AVAILABLE } from "../../lib/constants/updater";

interface RailFooterProps {
  /** The developer area is hidden: offer the link that reveals it. */
  showDeveloperLink: boolean;
  onOpenDeveloper: () => void;
  /** The version line opens About, where updates are installed. */
  onOpenAbout: () => void;
}

/**
 * The bottom of the settings rail (what the old footer bar carried): the
 * developer-area link, the engine that transcribes right now, and the version,
 * which turns blue when an update is waiting.
 */
export const RailFooter: React.FC<RailFooterProps> = ({
  showDeveloperLink,
  onOpenDeveloper,
  onOpenAbout,
}) => {
  const { t } = useTranslation();
  const {
    version,
    enabled,
    isChecking,
    availableVersion,
    isInstalling,
    downloadProgress,
  } = useUpdater();

  const updates = SELF_UPDATE_AVAILABLE && enabled;
  // The version keeps its lowercase "v" inside the uppercase mono line.
  const v = <span className="normal-case" />;
  let versionLine: React.ReactNode = version ? (
    <span className="normal-case">{`v${version}`}</span>
  ) : null;
  let tone = "text-text/35 hover:text-text/60";
  if (updates && isInstalling) {
    versionLine = t("footer.rail.installing", { progress: downloadProgress });
  } else if (updates && availableVersion) {
    versionLine = (
      <Trans
        i18nKey="footer.rail.updateAvailable"
        values={{ version: availableVersion }}
        components={{ v }}
      />
    );
    tone = "text-logo-primary hover:brightness-125";
  } else if (updates && version) {
    versionLine = (
      <Trans
        i18nKey={isChecking ? "footer.rail.checking" : "footer.rail.upToDate"}
        values={{ version }}
        components={{ v }}
      />
    );
  }

  return (
    <div className="px-2.5 flex flex-col items-start gap-2 font-mono text-[10px] leading-[1.4] tracking-[0.06em] uppercase text-text/35">
      {showDeveloperLink && (
        <button
          type="button"
          onClick={onOpenDeveloper}
          className="uppercase tracking-[0.06em] text-text/55 hover:text-text cursor-pointer rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {t("sidebar.developerLink")}
        </button>
      )}
      {/* Engine status (and the model download meter while one runs). */}
      <div className="w-full min-w-0 [&_.w-2]:w-1.5 [&_.w-2]:h-1.5 [&_.bg-green-400]:!bg-accent [&_.bg-green-400]:shadow-[0_0_8px_rgba(33,64,255,0.7)]">
        <ModelSelector />
      </div>
      {versionLine && (
        <button
          type="button"
          onClick={onOpenAbout}
          title={t("sidebar.about")}
          className={`uppercase tracking-[0.06em] text-start tabular-nums cursor-pointer rounded-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${tone}`}
        >
          {versionLine}
        </button>
      )}
    </div>
  );
};

export default RailFooter;
