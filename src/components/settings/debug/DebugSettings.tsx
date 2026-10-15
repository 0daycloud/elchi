import React from "react";
import { useTranslation } from "react-i18next";
import { WordCorrectionThreshold } from "./WordCorrectionThreshold";
import { LogLevelSelector } from "./LogLevelSelector";
import { LiveLogViewer } from "./LiveLogViewer";
import { PasteDelay } from "./PasteDelay";
import { HoldThreshold } from "./HoldThreshold";
import { ReliablePasteToggle } from "./ReliablePaste";
import { RecordingBuffer } from "./RecordingBuffer";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AlwaysOnMicrophone } from "../AlwaysOnMicrophone";
import { SoundPicker } from "../SoundPicker";
import { ClamshellMicrophoneSelector } from "../ClamshellMicrophoneSelector";
import { WhatsNewPreview } from "./WhatsNewPreview";
import { KeyboardDiagnostic } from "./KeyboardDiagnostic";
import {
  OnboardingPreview,
  type OnboardingPreviewStep,
} from "./OnboardingPreview";

interface DebugSettingsProps {
  onPreviewOnboarding?: (step: OnboardingPreviewStep) => void;
}

export const DebugSettings: React.FC<DebugSettingsProps> = ({
  onPreviewOnboarding,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-[22px]">
      <SettingsGroup title={t("settings.debug.groups.previews")}>
        <WhatsNewPreview descriptionMode="tooltip" grouped />
        {onPreviewOnboarding && (
          <OnboardingPreview
            onPreview={onPreviewOnboarding}
            descriptionMode="tooltip"
            grouped
          />
        )}
      </SettingsGroup>

      <SettingsGroup title={t("settings.debug.groups.input")}>
        <WordCorrectionThreshold descriptionMode="tooltip" grouped />
        <PasteDelay descriptionMode="tooltip" grouped />
        <PasteDelay
          descriptionMode="tooltip"
          grouped
          settingKey="paste_delay_after_ms"
          labelKey="settings.debug.pasteDelayAfter.title"
          descriptionKey="settings.debug.pasteDelayAfter.description"
        />
        <ReliablePasteToggle descriptionMode="tooltip" grouped />
        <HoldThreshold descriptionMode="tooltip" grouped />
        <KeyboardDiagnostic />
      </SettingsGroup>

      <SettingsGroup title={t("settings.debug.groups.audio")}>
        <SoundPicker
          label={t("settings.debug.soundTheme.label")}
          description={t("settings.debug.soundTheme.description")}
        />
        <RecordingBuffer descriptionMode="tooltip" grouped />
        <AlwaysOnMicrophone descriptionMode="tooltip" grouped />
        <ClamshellMicrophoneSelector descriptionMode="tooltip" grouped />
      </SettingsGroup>

      <SettingsGroup title={t("settings.debug.groups.logs")}>
        <LogLevelSelector grouped />
        <LiveLogViewer descriptionMode="tooltip" grouped />
      </SettingsGroup>
    </div>
  );
};
