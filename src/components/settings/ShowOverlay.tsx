import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import { useOsType } from "../../hooks/useOsType";
import type { AppSettings, OverlayPosition, OverlayStyle } from "@/bindings";
import { ChangedMark } from "./ChangedMark";

interface ShowOverlayProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  /** Marks rows whose setting differs from its default (Gelişmiş). */
  isChanged?: (key: keyof AppSettings) => boolean;
}

export const ShowOverlay: React.FC<ShowOverlayProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false, isChanged }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const osType = useOsType();

    const styleOptions = [
      {
        value: "none",
        label: t("settings.advanced.overlay.style.options.none"),
      },
      {
        value: "minimal",
        label: t("settings.advanced.overlay.style.options.minimal"),
      },
      {
        value: "live",
        label: t("settings.advanced.overlay.style.options.live"),
      },
    ];

    const positionOptions = [
      {
        value: "bottom",
        label: t("settings.advanced.overlay.position.options.bottom"),
      },
      {
        value: "top",
        label: t("settings.advanced.overlay.position.options.top"),
      },
    ];

    const selectedStyle = (getSetting("overlay_style") ||
      "live") as OverlayStyle;
    // Only "top" and "bottom" are selectable; anything else (empty, or a legacy
    // "none" from before the position was retired) falls back to "bottom".
    const selectedPosition: OverlayPosition =
      getSetting("overlay_position") === "top" ? "top" : "bottom";

    return (
      <>
        <ChangedMark on={isChanged?.("overlay_style") ?? false}>
          <SettingContainer
            title={t("settings.advanced.overlay.style.title")}
            description={t("settings.advanced.overlay.style.description")}
            descriptionMode={descriptionMode}
            grouped={grouped}
          >
            <Dropdown
              options={styleOptions}
              selectedValue={selectedStyle}
              onSelect={(value) =>
                updateSetting("overlay_style", value as OverlayStyle)
              }
              disabled={isUpdating("overlay_style")}
            />
          </SettingContainer>
        </ChangedMark>

        {selectedStyle !== "none" && (
          <ChangedMark on={isChanged?.("overlay_position") ?? false}>
            <SettingContainer
              title={t("settings.advanced.overlay.position.title")}
              description={t("settings.advanced.overlay.position.description")}
              descriptionMode={descriptionMode}
              grouped={grouped}
            >
              <Dropdown
                options={positionOptions}
                selectedValue={selectedPosition}
                onSelect={(value) =>
                  updateSetting("overlay_position", value as OverlayPosition)
                }
                disabled={isUpdating("overlay_position")}
              />
            </SettingContainer>
          </ChangedMark>
        )}

        {/* Linux only until the click-through idle window is verified on macOS and Windows. */}
        {selectedStyle !== "none" && osType === "linux" && (
          <ToggleSwitch
            checked={getSetting("overlay_idle_line") ?? false}
            onChange={(enabled) => updateSetting("overlay_idle_line", enabled)}
            isUpdating={isUpdating("overlay_idle_line")}
            label={t("settings.advanced.overlay.idleLine.label")}
            description={t("settings.advanced.overlay.idleLine.description")}
            descriptionMode={descriptionMode}
            grouped={grouped}
            tooltipPosition="bottom"
          />
        )}
      </>
    );
  },
);
