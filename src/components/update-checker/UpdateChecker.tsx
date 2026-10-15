import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { useUpdater } from "./UpdaterContext";
import { PORTABLE_RELEASES_URL } from "./portableInstaller";

interface UpdateCheckerProps {
  className?: string;
}

/**
 * The update control on the About page: status in mono, one action (check,
 * or install and restart), a cell meter while the update downloads, and the
 * manual-update dialog for portable installs.
 */
const UpdateChecker: React.FC<UpdateCheckerProps> = ({ className = "" }) => {
  const { t } = useTranslation();
  const {
    enabled,
    isChecking,
    availableVersion,
    isInstalling,
    downloadProgress,
    showUpToDate,
    portableDialogOpen,
    portableInstallerUrl,
    checkNow,
    install,
    closePortableDialog,
  } = useUpdater();

  const status = (): React.ReactNode => {
    if (!enabled) return t("footer.updateCheckingDisabled");
    if (isInstalling) {
      return downloadProgress > 0 && downloadProgress < 100
        ? t("footer.downloading", { progress: downloadProgress.toString() })
        : downloadProgress === 100
          ? t("footer.installing")
          : t("footer.preparing");
    }
    if (isChecking) return t("footer.checkingUpdates");
    if (availableVersion)
      return (
        <Trans
          i18nKey="footer.updateAvailableVersion"
          values={{ version: availableVersion }}
          components={{ v: <span className="normal-case" /> }}
        />
      );
    if (showUpToDate) return t("footer.upToDate");
    return "";
  };

  // When no installer could be resolved for this target the button falls back
  // to the releases index, so the dialog has to say "browse", not "download".
  const hasDirectInstaller = portableInstallerUrl !== PORTABLE_RELEASES_URL;
  const text = status();

  return (
    <>
      <div className={`flex items-center gap-3 ${className}`}>
        {text && (
          <span
            role="status"
            className={`font-mono text-[10.5px] tracking-[0.06em] uppercase tabular-nums ${
              availableVersion && !isInstalling
                ? "text-logo-primary"
                : "text-mid-gray"
            }`}
          >
            {text}
          </span>
        )}
        {enabled && availableVersion && !isInstalling && (
          <Button variant="primary" size="sm" onClick={() => void install()}>
            {t("footer.installAndRestart")}
          </Button>
        )}
        {enabled && !availableVersion && !isInstalling && (
          <Button
            variant="secondary"
            size="sm"
            onClick={checkNow}
            disabled={isChecking}
          >
            {t("footer.checkForUpdates")}
          </Button>
        )}
      </div>
      {isInstalling && downloadProgress > 0 && downloadProgress < 100 && (
        <div
          aria-hidden="true"
          className="mt-2.5 flex h-1.5 gap-[2px]"
          title={`${downloadProgress}%`}
        >
          {Array.from({ length: 40 }, (_, i) => (
            <span
              key={i}
              className={`flex-1 ${
                i < Math.round((downloadProgress / 100) * 40)
                  ? "bg-accent"
                  : "bg-[var(--cell-off)]"
              }`}
            />
          ))}
        </div>
      )}
      <Dialog
        open={portableDialogOpen}
        title={t("footer.portableUpdateTitle")}
        closeLabel={t("common.close")}
        onOpenChange={(open) => !open && closePortableDialog()}
        contentFades={false}
        footer={
          <>
            <Button variant="secondary" onClick={closePortableDialog}>
              {t("common.close")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                openUrl(portableInstallerUrl);
                closePortableDialog();
              }}
            >
              {hasDirectInstaller
                ? t("footer.portableUpdateButton")
                : t("footer.portableUpdateBrowseButton")}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-text/75">
          {hasDirectInstaller
            ? t("footer.portableUpdateMessage")
            : t("footer.portableUpdateBrowseMessage")}
        </p>
      </Dialog>
    </>
  );
};

export default UpdateChecker;
