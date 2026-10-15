import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { commands, type AppSettings } from "@/bindings";
import { ShowOverlay } from "../ShowOverlay";
import { ModelUnloadTimeoutSetting } from "../ModelUnloadTimeout";
import { CustomWords } from "../CustomWords";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "../../ui/Button";
import { StartHidden } from "../StartHidden";
import { AutostartToggle } from "../AutostartToggle";
import { ShowTrayIcon } from "../ShowTrayIcon";
import { ShowInDock } from "../ShowInDock";
import { PasteMethodSetting } from "../PasteMethod";
import { TypingToolSetting } from "../TypingTool";
import { ClipboardHandlingSetting } from "../ClipboardHandling";
import { AutoSubmit } from "../AutoSubmit";
import { PostProcessingToggle } from "../PostProcessingToggle";
import { AppendTrailingSpace } from "../AppendTrailingSpace";
import { HistoryLimit } from "../HistoryLimit";
import { RecordingRetentionPeriodSelector } from "../RecordingRetentionPeriod";
import { ExperimentalToggle } from "../ExperimentalToggle";
import { UpdateChecksToggle } from "../UpdateChecksToggle";
import { AppDataDirectory } from "../AppDataDirectory";
import { useSettings } from "../../../hooks/useSettings";
import { useOsType } from "../../../hooks/useOsType";
import { KeyboardImplementationSelector } from "../debug/KeyboardImplementationSelector";
import { VoiceActivityDetection } from "../VoiceActivityDetection";
import { AccelerationSelector } from "../AccelerationSelector";
import { LazyStreamClose } from "../LazyStreamClose";
import { ChineseScriptSetting } from "../ChineseScript";
import { VadBackendSelector } from "../VadBackendSelector";
import { SELF_UPDATE_AVAILABLE } from "../../../lib/constants/updater";
import { useChangedSettings } from "./changedSettings";
import { ChangedMark } from "../ChangedMark";

/**
 * Gelişmiş (design frame 3c), tiered: what people do change (start-up, the
 * recording indicator, history) first; everything rarely touched behind one
 * dashed row. Every setting that was here stays reachable.
 */
export const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const osType = useOsType();
  const { changed } = useChangedSettings();
  const [showRare, setShowRare] = useState(false);
  const rareId = useId();
  const experimentalEnabled = getSetting("experimental_enabled") || false;
  const is = (key: keyof AppSettings) =>
    (changed as Set<keyof AppSettings>).has(key);

  // Rows behind the dashed toggle, counted as they will render.
  const typingToolShown =
    osType === "linux" && getSetting("paste_method") === "direct";
  const rareCount =
    9 +
    (typingToolShown ? 1 : 0) +
    (SELF_UPDATE_AVAILABLE ? 1 : 0) +
    (experimentalEnabled ? 5 : 0);

  const openRecordings = async () => {
    try {
      const result = await commands.openRecordingsFolder();
      if (result.status === "error") console.error(result.error);
    } catch (error) {
      console.error("Failed to open recordings folder:", error);
    }
  };

  return (
    <div className="flex flex-col gap-[22px]">
      <SettingsGroup title={t("settings.advanced.groups.app")}>
        <ChangedMark on={is("autostart_enabled")}>
          <AutostartToggle descriptionMode="tooltip" grouped />
        </ChangedMark>
        <ChangedMark on={is("start_hidden")}>
          <StartHidden descriptionMode="tooltip" grouped />
        </ChangedMark>
        <ChangedMark on={is("show_tray_icon")}>
          <ShowTrayIcon descriptionMode="tooltip" grouped />
        </ChangedMark>
        {osType === "macos" && (
          <ChangedMark on={is("show_in_dock")}>
            <ShowInDock descriptionMode="tooltip" grouped />
          </ChangedMark>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.indicator")}>
        <ShowOverlay descriptionMode="tooltip" grouped isChanged={is} />
        <ModelUnloadTimeoutSetting descriptionMode="tooltip" grouped />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.advanced.groups.history")}
        hint={t("settings.advanced.groups.historyHint")}
      >
        <ChangedMark on={is("history_limit")}>
          <HistoryLimit descriptionMode="tooltip" grouped />
        </ChangedMark>
        <ChangedMark on={is("recording_retention_period")}>
          <RecordingRetentionPeriodSelector descriptionMode="tooltip" grouped />
        </ChangedMark>
        <SettingContainer
          title={t("settings.advanced.recordingsFolder.title")}
          description={t("settings.advanced.recordingsFolder.description")}
          descriptionMode="tooltip"
          grouped
        >
          <Button variant="secondary" size="sm" onClick={openRecordings}>
            {t("common.open")}
          </Button>
        </SettingContainer>
      </SettingsGroup>

      <button
        type="button"
        aria-expanded={showRare}
        aria-controls={rareId}
        onClick={() => setShowRare((v) => !v)}
        className="flex items-center justify-between gap-4 px-[18px] py-3.5 rounded-[10px] border border-dashed border-text/[0.14] text-start text-[12.5px] text-text/55 hover:text-text/80 hover:border-text/25 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="min-w-0 truncate">
          {t("settings.advanced.rare.summary", { count: rareCount })}
        </span>
        <span className="shrink-0 inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.06em] uppercase text-logo-primary">
          {showRare
            ? t("settings.advanced.rare.hide")
            : t("settings.advanced.rare.show")}
          <ChevronDown
            aria-hidden="true"
            className={`w-3 h-3 transition-transform ${showRare ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {showRare && (
        <div id={rareId} className="flex flex-col gap-[22px]">
          <SettingsGroup title={t("settings.advanced.groups.output")}>
            <PasteMethodSetting descriptionMode="tooltip" grouped />
            <TypingToolSetting descriptionMode="tooltip" grouped />
            <ClipboardHandlingSetting descriptionMode="tooltip" grouped />
            <AutoSubmit descriptionMode="tooltip" grouped />
            <AppendTrailingSpace descriptionMode="tooltip" grouped />
          </SettingsGroup>

          <SettingsGroup title={t("settings.advanced.groups.transcription")}>
            <VoiceActivityDetection descriptionMode="tooltip" grouped />
            <ChineseScriptSetting descriptionMode="tooltip" grouped />
            <CustomWords descriptionMode="tooltip" grouped />
          </SettingsGroup>

          <SettingsGroup title={t("settings.advanced.groups.system")}>
            {SELF_UPDATE_AVAILABLE && (
              <UpdateChecksToggle descriptionMode="tooltip" grouped />
            )}
            <AppDataDirectory descriptionMode="tooltip" grouped />
            <ExperimentalToggle descriptionMode="tooltip" grouped />
          </SettingsGroup>

          {experimentalEnabled && (
            <SettingsGroup title={t("settings.advanced.groups.experimental")}>
              <PostProcessingToggle descriptionMode="tooltip" grouped />
              <KeyboardImplementationSelector
                descriptionMode="tooltip"
                grouped
              />
              <AccelerationSelector descriptionMode="tooltip" grouped />
              <LazyStreamClose descriptionMode="tooltip" grouped />
              <VadBackendSelector descriptionMode="tooltip" grouped />
            </SettingsGroup>
          )}
        </div>
      )}
    </div>
  );
};
