import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { arch, platform } from "@tauri-apps/plugin-os";
import { useSettings } from "../../hooks/useSettings";
import { commands } from "../../bindings";
import {
  resolvePortableInstallerUrl,
  PORTABLE_RELEASES_URL,
} from "./portableInstaller";

/**
 * What went wrong in the last update step the user started: a manual check,
 * the download and install, or the relaunch after a good install.
 */
export type UpdateErrorKind = "check" | "install" | "relaunch";

export interface UpdateError {
  kind: UpdateErrorKind;
  /** The updater's own message, shown under ours for bug reports. */
  detail: string;
}

export interface UpdaterState {
  /** The running version ("1.0.2"), empty until known. */
  version: string;
  /** Update checks are on (the setting, unless the system locks them off). */
  enabled: boolean;
  isChecking: boolean;
  /** Set once a check found a newer release. */
  availableVersion: string | null;
  isInstalling: boolean;
  /** 0–100 while an update downloads. */
  downloadProgress: number;
  /** A manual check just came back with nothing new (clears after 3s). */
  showUpToDate: boolean;
  /** The last manual check, install or relaunch failed; cleared on retry. */
  error: UpdateError | null;
  /** Portable installs cannot self-update: the manual-update dialog. */
  portableDialogOpen: boolean;
  portableInstallerUrl: string;
  checkNow: () => void;
  install: () => Promise<void>;
  closePortableDialog: () => void;
}

const UpdaterContext = createContext<UpdaterState | null>(null);

/**
 * Owns the self-updater for the main window: checks on start (when enabled),
 * answers the tray's "check-for-updates" event and installs on request. The
 * settings rail shows its status and the About page drives it, so both read
 * the same state instead of checking twice.
 */
export const UpdaterProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [version, setVersion] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showUpToDate, setShowUpToDate] = useState(false);
  const [error, setError] = useState<UpdateError | null>(null);
  const [portableDialogOpen, setPortableDialogOpen] = useState(false);
  const [portableInstallerUrl, setPortableInstallerUrl] = useState<string>(
    PORTABLE_RELEASES_URL,
  );

  const { settings, isLoading, updateChecksLocked } = useSettings();
  // Wait for the lock state too (null = not loaded yet), otherwise the first
  // render could fire an update check before HANDY_DISABLE_UPDATER is known.
  const settingsLoaded =
    !isLoading && settings !== null && updateChecksLocked !== null;
  // Forced-off by system configuration (HANDY_DISABLE_UPDATER) overrides the
  // stored preference without persisting it, mirroring the backend's effective
  // updater state.
  const enabled =
    (settings?.update_checks_enabled ?? false) && updateChecksLocked === false;

  const upToDateTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isCheckingRef = useRef(false);
  const isManualCheckRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch((error) => console.error("Failed to get app version:", error));
  }, []);

  const runCheck = useCallback(async () => {
    if (!enabledRef.current || isCheckingRef.current) return;
    const manual = isManualCheckRef.current;
    try {
      isCheckingRef.current = true;
      setIsChecking(true);
      if (manual) setError(null);
      const update = await check();
      if (update) {
        setAvailableVersion(update.version);
        setShowUpToDate(false);
        // Portable installs can't self-update in place — the manual dialog
        // links straight at the matching installer from this manifest instead.
        setPortableInstallerUrl(
          resolvePortableInstallerUrl(update.rawJson, platform(), arch()),
        );
      } else {
        setAvailableVersion(null);
        if (manual) {
          setShowUpToDate(true);
          clearTimeout(upToDateTimeoutRef.current);
          upToDateTimeoutRef.current = setTimeout(
            () => setShowUpToDate(false),
            3000,
          );
        }
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
      // The check on start stays quiet (offline at login is normal); one the
      // user asked for says it failed.
      if (manual) setError({ kind: "check", detail: String(err) });
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
      isManualCheckRef.current = false;
    }
  }, []);

  const checkNow = useCallback(() => {
    if (!enabledRef.current) return;
    isManualCheckRef.current = true;
    void runCheck();
  }, [runCheck]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (!enabled) {
      clearTimeout(upToDateTimeoutRef.current);
      setIsChecking(false);
      setAvailableVersion(null);
      setShowUpToDate(false);
      setError(null);
      return;
    }
    void runCheck();
    const unlisten = listen("check-for-updates", checkNow);
    return () => {
      clearTimeout(upToDateTimeoutRef.current);
      unlisten.then((fn) => fn());
    };
  }, [settingsLoaded, enabled, runCheck, checkNow]);

  const install = useCallback(async () => {
    if (!enabledRef.current) return;
    let downloaded = 0;
    let contentLength = 0;
    let installed = false;
    try {
      setError(null);
      if (await commands.isPortable()) {
        setPortableDialogOpen(true);
        return;
      }
      setIsInstalling(true);
      setDownloadProgress(0);
      const update = await check();
      if (!update) {
        // The release was pulled since the last check: nothing to install.
        console.log("No update available during install attempt");
        setAvailableVersion(null);
        return;
      }
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            downloaded = 0;
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress": {
            downloaded += event.data.chunkLength;
            const progress =
              contentLength > 0
                ? Math.round((downloaded / contentLength) * 100)
                : 0;
            setDownloadProgress(Math.min(progress, 100));
            break;
          }
        }
      });
      installed = true;
      await relaunch();
    } catch (err) {
      // Say which step failed: with the console alone the button looks dead.
      console.error(
        installed
          ? "Update installed but relaunch failed:"
          : "Failed to install update:",
        err,
      );
      setError({
        kind: installed ? "relaunch" : "install",
        detail: String(err),
      });
    } finally {
      setIsInstalling(false);
      setDownloadProgress(0);
    }
  }, []);

  const value: UpdaterState = {
    version,
    enabled,
    isChecking,
    availableVersion,
    isInstalling,
    downloadProgress,
    showUpToDate,
    error,
    portableDialogOpen,
    portableInstallerUrl,
    checkNow,
    install,
    closePortableDialog: () => setPortableDialogOpen(false),
  };

  return (
    <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>
  );
};

export const useUpdater = (): UpdaterState => {
  const ctx = useContext(UpdaterContext);
  if (!ctx) throw new Error("useUpdater must be used inside UpdaterProvider");
  return ctx;
};
