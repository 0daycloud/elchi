import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown, Loader2 } from "lucide-react";
import type { ModelInfo } from "@/bindings";
import type { ModelCardStatus } from "./ModelCard";
import { isLegacySource } from "./ModelCard";
import { formatModelSize } from "../../lib/utils/format";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "../../lib/utils/modelTranslation";
import {
  getLanguageLabel,
  getUniqueCapabilityLanguages,
} from "../../lib/constants/languages";
import { useModelStore } from "../../stores/modelStore";
import "./onboarding.css";

interface OnboardingProps {
  onModelSelected: () => void;
  preview?: boolean;
}

const Onboarding: React.FC<OnboardingProps> = ({
  onModelSelected,
  preview = false,
}) => {
  const { t } = useTranslation();
  const {
    models,
    downloadModel,
    selectModel,
    downloadingModels,
    verifyingModels,
    extractingModels,
    downloadProgress,
    downloadStats,
    cancelDownload,
  } = useModelStore();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const hasStartedSelection = useRef(false);

  const isBusy = selectedModelId !== null;

  // Curate the download list: legacy (.bin/ONNX) downloads are deprecated and
  // never shown here (they still appear in the compatible section if already on
  // disk). The catalog arrives rank-sorted, so recommended models lead.
  // Everything else hides behind "Show all".
  const { downloaded, downloadable, recommended, rest } = useMemo(() => {
    const downloaded = models.filter((m: ModelInfo) => m.is_downloaded);
    const downloadable = models.filter(
      (m: ModelInfo) => !m.is_downloaded && !isLegacySource(m),
    );
    // `models` arrives in editorial rank order (the backend sorts by rank_of,
    // then accuracy), so keep that order here: ranked-but-not-recommended models
    // surface first, then the unranked tail by accuracy.
    return {
      downloaded,
      downloadable,
      recommended: downloadable.filter((m: ModelInfo) => m.is_recommended),
      rest: downloadable.filter((m: ModelInfo) => !m.is_recommended),
    };
  }, [models]);

  const hasRecommended = recommended.length > 0;
  // When nothing recommended remains to download (e.g. all already on disk),
  // there is no curated subset to collapse, so just show the full list.
  const showRest = showAll || !hasRecommended;

  // Watch for the selected model to finish downloading + verifying + extracting
  useEffect(() => {
    // Debug previews are inert: never switch the user's active model. Guarded
    // here as well as in the handlers because this is where the backend call
    // actually happens.
    if (preview) return;

    if (!selectedModelId) {
      hasStartedSelection.current = false;
      return;
    }

    const model = models.find((m) => m.id === selectedModelId);
    const stillDownloading = selectedModelId in downloadingModels;
    const stillVerifying = selectedModelId in verifyingModels;
    const stillExtracting = selectedModelId in extractingModels;

    if (
      model?.is_downloaded &&
      !stillDownloading &&
      !stillVerifying &&
      !stillExtracting &&
      !hasStartedSelection.current
    ) {
      hasStartedSelection.current = true;

      // Model is ready — select it and transition
      selectModel(selectedModelId).then((success) => {
        if (success) {
          onModelSelected();
        } else {
          toast.error(t("onboarding.errors.selectModel"));
          hasStartedSelection.current = false;
          setSelectedModelId(null);
        }
      });
    }
  }, [
    selectedModelId,
    models,
    downloadingModels,
    verifyingModels,
    extractingModels,
    selectModel,
    onModelSelected,
    preview,
    t,
  ]);

  const handleDownloadModel = async (modelId: string) => {
    if (preview) return;

    setSelectedModelId(modelId);

    // Error toast is handled centrally by the model-download-failed event listener
    // in modelStore — no toast here to avoid duplicates.
    const success = await downloadModel(modelId);
    if (!success) {
      setSelectedModelId(null);
    }
  };

  const handleCancelDownload = async (modelId: string) => {
    if (preview) return;

    const success = await cancelDownload(modelId);
    if (success) {
      setSelectedModelId(null);
    }
  };

  const handleSelectExistingModel = (modelId: string) => {
    if (preview) return;

    setSelectedModelId(modelId);
  };

  const getModelStatus = (modelId: string): ModelCardStatus => {
    if (modelId in extractingModels) return "extracting";
    if (modelId in verifyingModels) return "verifying";
    if (modelId in downloadingModels) return "downloading";
    return "downloadable";
  };

  const downloadCard = (model: ModelInfo) => (
    <ModelPick
      key={model.id}
      model={model}
      status={getModelStatus(model.id)}
      disabled={isBusy}
      onChoose={handleDownloadModel}
      onCancel={handleCancelDownload}
      progress={downloadProgress[model.id]?.percentage}
      speed={downloadStats[model.id]?.speed}
    />
  );

  return (
    <div className="onb-pane h-screen w-full flex flex-col gap-5 px-10 pt-9 pb-8 overflow-y-auto">
      <header className="flex flex-col gap-2 shrink-0 pe-36">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
          {t("onboarding.modelPicker.eyebrow")}
        </span>
        <h1 className="font-light text-[30px] leading-[1.1] tracking-[-0.025em]">
          {t("onboarding.modelPicker.title")}
        </h1>
      </header>

      <div className="grid grid-cols-2 gap-3">
        {downloaded.map((model: ModelInfo) => (
          <ModelPick
            key={model.id}
            model={model}
            status={selectedModelId === model.id ? "switching" : "available"}
            disabled={isBusy}
            onChoose={handleSelectExistingModel}
          />
        ))}
        {recommended.map(downloadCard)}
        {showRest && rest.map(downloadCard)}
      </div>

      {hasRecommended && rest.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="self-center inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)] hover:text-text transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {showAll
            ? t("onboarding.showFewerModels")
            : t("onboarding.showAllModels", { total: downloadable.length })}
          <ChevronDown
            aria-hidden="true"
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              showAll ? "rotate-180" : ""
            }`}
          />
        </button>
      )}
    </div>
  );
};

const CELLS = 20;

/** A score as a row of small cells (design 3d: DOĞRULUK / HIZ). */
const ScoreCells: React.FC<{ label: string; score: number; blue: boolean }> = ({
  label,
  score,
  blue,
}) => {
  const lit = Math.round(Math.max(0, Math.min(1, score)) * CELLS);
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-2.5">
      <span>{label}</span>
      <span
        className="flex gap-0.5 h-1.5"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(score * 100)}
      >
        {Array.from({ length: CELLS }, (_, i) => (
          <span
            key={i}
            className={`flex-1 ${
              i < lit ? (blue ? "bg-accent" : "onb-cell-muted") : "onb-cell-off"
            }`}
          />
        ))}
      </span>
    </div>
  );
};

interface ModelPickProps {
  model: ModelInfo;
  status: ModelCardStatus;
  disabled: boolean;
  onChoose: (modelId: string) => void;
  onCancel?: (modelId: string) => void;
  progress?: number;
  speed?: number;
}

/** One model in the picker: a steel card, blue-edged when recommended. */
const ModelPick: React.FC<ModelPickProps> = ({
  model,
  status,
  disabled,
  onChoose,
  onCancel,
  progress,
  speed,
}) => {
  const { t } = useTranslation();
  const recommended = model.is_recommended && !model.is_downloaded;
  const clickable = status === "available" || status === "downloadable";
  const name = getTranslatedModelName(model, t);
  const languages = getUniqueCapabilityLanguages(model.supported_languages);

  const meta = [
    Number(model.size_mb) > 0 ? formatModelSize(Number(model.size_mb)) : null,
    languages.length === 1
      ? getLanguageLabel(languages[0]) || languages[0]
      : languages.length > 1
        ? t("onboarding.modelPicker.languages", { count: languages.length })
        : null,
    model.supports_translation ? t("onboarding.modelPicker.translation") : null,
    model.supports_streaming ? t("onboarding.modelPicker.streaming") : null,
  ].filter(Boolean);

  const choose = () => {
    if (clickable && !disabled) onChoose(model.id);
  };

  const action = (() => {
    switch (status) {
      case "downloading":
        return (
          <span className="flex items-center gap-3">
            <span className="tabular-nums text-accent-soft">
              {t("onboarding.modelPicker.downloading", {
                percentage: Math.round(progress ?? 0),
              })}
              {speed !== undefined &&
                speed > 0 &&
                ` · ${t("onboarding.modelPicker.speed", { speed: speed.toFixed(1) })}`}
            </span>
            {onCancel && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel(model.id);
                }}
                className="uppercase tracking-[0.06em] hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded"
              >
                {t("onboarding.modelPicker.cancel")}
              </button>
            )}
          </span>
        );
      case "verifying":
      case "extracting":
      case "switching":
        return (
          <span className="inline-flex items-center gap-1.5 text-accent-soft">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
            {status === "verifying"
              ? t("onboarding.modelPicker.verifying")
              : status === "extracting"
                ? t("onboarding.modelPicker.extracting")
                : t("onboarding.modelPicker.switching")}
          </span>
        );
      case "available":
        return <span>{t("onboarding.modelPicker.select")}</span>;
      default:
        return (
          <span className={recommended ? "text-accent-soft" : ""}>
            {t("onboarding.modelPicker.download")} →
          </span>
        );
    }
  })();

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable && !disabled ? 0 : undefined}
      aria-disabled={clickable && disabled ? true : undefined}
      onClick={choose}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && clickable) {
          e.preventDefault();
          choose();
        }
      }}
      className={`${recommended ? "onb-pick" : "steel-panel"} flex flex-col gap-3.5 px-[22px] pt-5 pb-4 text-left transition-[transform,opacity] duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${
        clickable
          ? disabled
            ? "opacity-50 cursor-not-allowed"
            : "cursor-pointer hover:-translate-y-px"
          : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-medium tracking-[-0.01em] truncate">
          {name}
        </h3>
        <span className="flex gap-1.5 shrink-0">
          {model.is_custom && <Tag>{t("onboarding.modelPicker.custom")}</Tag>}
          {model.is_downloaded ? (
            <Tag>{t("onboarding.modelPicker.downloaded")}</Tag>
          ) : (
            model.is_recommended && (
              <Tag blue>{t("onboarding.recommended")}</Tag>
            )
          )}
        </span>
      </div>
      <p className="min-h-[38px] text-[12.5px] leading-normal text-mid-gray [text-wrap:pretty]">
        {getTranslatedModelDescription(model, t)}
      </p>
      {(model.accuracy_score > 0 || model.speed_score > 0) && (
        <div className="flex flex-col gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--text-faint)]">
          <ScoreCells
            label={t("onboarding.modelCard.accuracy")}
            score={model.accuracy_score}
            blue={recommended}
          />
          <ScoreCells
            label={t("onboarding.modelCard.speed")}
            score={model.speed_score}
            blue={recommended}
          />
        </div>
      )}
      {status === "downloading" && (
        <span
          className="flex gap-0.5 h-1"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress ?? 0)}
          aria-label={name}
        >
          {Array.from({ length: 40 }, (_, i) => (
            <span
              key={i}
              className={`flex-1 ${
                i < Math.round(((progress ?? 0) / 100) * 40)
                  ? "bg-accent"
                  : "onb-cell-off"
              }`}
            />
          ))}
        </span>
      )}
      <div className="hairline-t flex items-center justify-between gap-3 pt-3 font-mono text-[10.5px] uppercase tracking-[0.06em] text-mid-gray">
        <span className="truncate">{meta.join(" · ")}</span>
        <span className="shrink-0">{action}</span>
      </div>
    </div>
  );
};

const Tag: React.FC<{ blue?: boolean; children: React.ReactNode }> = ({
  blue,
  children,
}) => (
  <span
    className={`rounded px-[7px] py-[3px] font-mono text-[10px] uppercase tracking-[0.08em] ${
      blue ? "onb-tag-blue text-accent-soft" : "onb-tag text-text/70"
    }`}
  >
    {children}
  </span>
);

export default Onboarding;
