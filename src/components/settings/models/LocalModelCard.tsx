import React from "react";
import { useTranslation } from "react-i18next";
import type { ModelInfo } from "@/bindings";
import type { ModelCardStatus } from "@/components/onboarding";
import { isLegacySource } from "@/components/onboarding/ModelCard";
import { DownloadCells } from "@/components/shared/ProgressBar";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "@/lib/utils/modelTranslation";
import {
  getLanguageLabel,
  getUniqueCapabilityLanguages,
} from "@/lib/constants/languages";

const MB = 1024 * 1024;

// A GGUF quantization label from a filename (e.g. "Q8_0"), for debug mode.
const getQuantLabel = (filename: string): string | null => {
  const match = filename.match(
    /[._-](IQ\d+_\w+|Q\d+(?:_\w+)?|F16|BF16|F32)\.gguf$/i,
  );
  return match ? match[1].toUpperCase() : null;
};

interface LocalModelCardProps {
  model: ModelInfo;
  status: ModelCardStatus;
  /** Duyu Pro is transcribing, so the active local model is the fallback. */
  cloudActive: boolean;
  /** Bytes downloaded so far and the total, while downloading. */
  progress?: { downloaded: number; total: number; percentage: number };
  /** MB/s while downloading. */
  speed?: number;
  onSelect: (modelId: string) => void;
  onDownload: (modelId: string) => void;
  onDelete: (modelId: string) => void;
  onCancel: (modelId: string) => void;
}

// Small mono tag next to the model name.
const Tag: React.FC<{ tone?: "accent" | "muted"; children: string }> = ({
  tone = "accent",
  children,
}) => (
  <span
    className={`rounded-[4px] px-[7px] py-[3px] font-mono text-[9.5px] uppercase leading-none tracking-[0.08em] ${
      tone === "accent"
        ? "bg-accent/[0.18] text-logo-primary"
        : "bg-text/[0.07] text-text/60"
    }`}
  >
    {children}
  </span>
);

// Thin 2px meter: accuracy and speed.
const Meter: React.FC<{ label: string; value: number }> = ({
  label,
  value,
}) => (
  <div className="grid min-w-[120px] flex-1 grid-cols-[auto_1fr] items-center gap-2.5">
    <span className="label-mono text-[10px] tracking-[0.06em]">{label}</span>
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="h-[2px] min-w-10"
      style={{
        background: `linear-gradient(90deg, var(--color-accent) 0 ${value * 100}%, var(--track-off) ${value * 100}%)`,
      }}
    />
  </div>
);

const chip =
  "steel-chip inline-flex h-[26px] items-center px-[9px] font-mono text-[10px] uppercase tracking-[0.06em] hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 cursor-pointer";

/**
 * A model on this computer (frame 1c "BU BİLGİSAYARDA"): name and state tag,
 * description, accuracy / speed meters and size, and its actions. While it
 * downloads, the meters give way to the 2d cell row with the byte count and
 * a cancel link.
 */
export const LocalModelCard: React.FC<LocalModelCardProps> = ({
  model,
  status,
  cloudActive,
  progress,
  speed,
  onSelect,
  onDownload,
  onDelete,
  onCancel,
}) => {
  const { t, i18n } = useTranslation();
  const debugMode = useSettingsStore(
    (state) => state.settings?.debug_mode ?? false,
  );
  const name = getTranslatedModelName(model, t);
  const description = getTranslatedModelDescription(model, t);
  const languages = getUniqueCapabilityLanguages(model.supported_languages);
  const quant = debugMode ? getQuantLabel(model.filename) : null;

  const num = (v: number, digits = 1) =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v);
  const size =
    model.size_mb >= 1024
      ? t("settings.models.local.sizeGb", { size: num(model.size_mb / 1024) })
      : t("settings.models.local.sizeMb", {
          size: num(model.size_mb, model.size_mb >= 10 ? 0 : 1),
        });
  const languageText =
    languages.length === 1
      ? (getLanguageLabel(languages[0]) ?? languages[0])
      : t("settings.models.local.languages", { count: languages.length });
  const meta = [
    size,
    ...(languages.length > 0 ? [languageText] : []),
    ...(model.supports_translation
      ? [t("modelSelector.capabilities.translate")]
      : []),
    ...(model.supports_streaming ? [t("modelSelector.streaming")] : []),
    ...(quant ? [quant] : []),
  ].join(" · ");

  const busy =
    status === "downloading" ||
    status === "verifying" ||
    status === "extracting";
  const isOnDisk = status === "active" || status === "available";

  const tag =
    status === "active"
      ? cloudActive
        ? t("settings.models.onDevice.fallback")
        : t("modelSelector.active")
      : status === "available"
        ? t("settings.models.local.downloaded")
        : status === "switching"
          ? t("modelSelector.switching")
          : status === "downloadable"
            ? t("settings.models.local.notDownloaded")
            : null;

  const pct = Math.max(0, Math.min(100, progress?.percentage ?? 0));
  const totalBytes =
    progress && progress.total > 0 ? progress.total : model.size_mb * MB;
  const doneBytes = progress ? progress.downloaded : 0;

  return (
    <article
      aria-label={name}
      className="panel flex flex-col gap-3.5 px-5 py-[18px]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 className="text-[15px] font-medium leading-tight tracking-[-0.01em]">
              {name}
            </h3>
            {tag && (
              <Tag tone={status === "downloadable" ? "muted" : "accent"}>
                {tag}
              </Tag>
            )}
            {model.is_custom && (
              <Tag tone="muted">{t("modelSelector.custom")}</Tag>
            )}
            {isLegacySource(model) && (
              <Tag tone="muted">{t("modelSelector.legacy")}</Tag>
            )}
          </div>
          <p className="text-[13px] leading-normal text-text/60 text-pretty">
            {description}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {status === "downloading" && (
            <span className="font-mono text-[10.5px] text-text/55 tabular-nums">
              {t("settings.models.local.progressMb", {
                done: num(doneBytes / MB),
                total: num(totalBytes / MB),
              })}
            </span>
          )}
          {status === "available" && (
            <button
              type="button"
              className={chip}
              onClick={() => onSelect(model.id)}
            >
              {t("settings.models.local.use")}
            </button>
          )}
          {isOnDisk && (
            <button
              type="button"
              className={chip}
              onClick={() => onDelete(model.id)}
              title={t("modelSelector.deleteModel", { modelName: name })}
              aria-label={t("modelSelector.deleteModel", { modelName: name })}
            >
              {t("settings.models.local.delete")}
            </button>
          )}
          {status === "downloadable" && (
            <button
              type="button"
              onClick={() => onDownload(model.id)}
              className="chrome-cta px-3.5 py-[7px] text-[12.5px] leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {t("settings.models.local.download")}
            </button>
          )}
        </div>
      </div>

      {busy ? (
        <div className="flex flex-col gap-2.5">
          <DownloadCells
            percentage={pct}
            indeterminate={status !== "downloading"}
            label={t("settings.models.local.downloadingLabel", {
              modelName: name,
            })}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="label-mono text-[10px] tracking-[0.06em] tabular-nums">
              {status === "downloading"
                ? [
                    t("settings.models.local.downloading", {
                      percentage: Math.round(pct),
                    }),
                    ...(speed !== undefined && speed > 0
                      ? [
                          t("modelSelector.downloadSpeed", {
                            speed: num(speed),
                          }),
                        ]
                      : []),
                  ].join(" · ")
                : status === "verifying"
                  ? t("modelSelector.verifyingGeneric")
                  : t("modelSelector.extractingGeneric")}
            </span>
            {status === "downloading" && (
              <button
                type="button"
                onClick={() => onCancel(model.id)}
                aria-label={t("modelSelector.cancelDownload")}
                className="rounded-sm font-mono text-[10px] uppercase tracking-[0.06em] text-error hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-error/50 cursor-pointer"
              >
                {t("modelSelector.cancel")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {model.accuracy_score > 0 && (
            <Meter
              label={t("settings.models.local.accuracy")}
              value={model.accuracy_score}
            />
          )}
          {model.speed_score > 0 && (
            <Meter
              label={t("settings.models.local.speed")}
              value={model.speed_score}
            />
          )}
          <div className="ms-auto flex shrink-0 items-baseline gap-2.5 whitespace-nowrap">
            <span className="label-mono text-[10px] tracking-[0.06em]">
              {t("settings.models.local.size")}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text/75 tabular-nums">
              {meta}
            </span>
          </div>
        </div>
      )}
    </article>
  );
};
