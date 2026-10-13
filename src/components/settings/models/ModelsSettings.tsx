import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import type { ModelCardStatus } from "@/components/onboarding";
import { ModelCard } from "@/components/onboarding";
import { useModelStore } from "@/stores/modelStore";
import type { ModelInfo } from "@/bindings";
import { ElchiProCard } from "./ElchiProCard";

/**
 * Elchi has two models: Duyu Pro in the cloud (the trial and Elchi Pro) and
 * Duyu-small on this computer, which is always there as the fallback.
 */
export const ModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const {
    models,
    currentModel,
    downloadingModels,
    downloadProgress,
    downloadStats,
    verifyingModels,
    extractingModels,
    loading,
    downloadModel,
    cancelDownload,
    selectModel,
    deleteModel,
  } = useModelStore();

  const getModelStatus = (modelId: string): ModelCardStatus => {
    if (modelId in extractingModels) {
      return "extracting";
    }
    if (modelId in verifyingModels) {
      return "verifying";
    }
    if (modelId in downloadingModels) {
      return "downloading";
    }
    if (switchingModelId === modelId) {
      return "switching";
    }
    const model = models.find((m: ModelInfo) => m.id === modelId);
    // A stale persisted selection must never make a missing model look Active.
    // Catalog models without files should offer their recovery action instead.
    if (!model?.is_downloaded) {
      return "downloadable";
    }
    if (modelId === currentModel) {
      return "active";
    }
    return "available";
  };

  const getDownloadProgress = (modelId: string): number | undefined => {
    const progress = downloadProgress[modelId];
    return progress?.percentage;
  };

  const getDownloadSpeed = (modelId: string): number | undefined => {
    const stats = downloadStats[modelId];
    return stats?.speed;
  };

  const handleModelSelect = async (modelId: string) => {
    setSwitchingModelId(modelId);
    try {
      await selectModel(modelId);
    } finally {
      setSwitchingModelId(null);
    }
  };

  const handleModelDownload = async (modelId: string) => {
    await downloadModel(modelId);
  };

  const handleModelDelete = async (modelId: string) => {
    const model = models.find((m: ModelInfo) => m.id === modelId);
    const modelName = model?.name || modelId;
    const isActive = modelId === currentModel;

    const confirmed = await ask(
      isActive
        ? t("settings.models.deleteActiveConfirm", { modelName })
        : t("settings.models.deleteConfirm", { modelName }),
      {
        title: t("settings.models.deleteTitle"),
        kind: "warning",
      },
    );

    if (confirmed) {
      try {
        await deleteModel(modelId);
      } catch (err) {
        console.error(`Failed to delete model ${modelId}:`, err);
      }
    }
  };

  const handleModelCancel = async (modelId: string) => {
    try {
      await cancelDownload(modelId);
    } catch (err) {
      console.error(`Failed to cancel download for ${modelId}:`, err);
    }
  };

  // Legacy (.bin/ONNX blob) entries stay hidden unless already on disk.
  const localModels = models.filter(
    (model: ModelInfo) =>
      !(
        typeof model.source === "object" &&
        "Url" in model.source &&
        !model.is_downloaded
      ),
  );

  if (loading) {
    return (
      <div className="max-w-3xl w-full mx-auto">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-logo-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl w-full mx-auto space-y-4">
      <div className="mb-4">
        <h1 className="text-xl font-semibold mb-2">
          {t("settings.models.title")}
        </h1>
        <p className="text-sm text-text/60">
          {t("settings.models.description")}
        </p>
      </div>

      <ElchiProCard />

      <section aria-labelledby="local-models-title" className="space-y-3">
        <div>
          <h2
            id="local-models-title"
            className="text-sm font-medium text-text/70"
          >
            {t("settings.models.onDevice.title")}
          </h2>
          <p className="text-xs text-text/70">
            {t("settings.models.onDevice.description")}
          </p>
        </div>
        {localModels.map((model: ModelInfo) => (
          <ModelCard
            key={model.id}
            model={model}
            status={getModelStatus(model.id)}
            onSelect={handleModelSelect}
            onDownload={handleModelDownload}
            onDelete={handleModelDelete}
            onCancel={handleModelCancel}
            downloadProgress={getDownloadProgress(model.id)}
            downloadSpeed={getDownloadSpeed(model.id)}
            showRecommended={false}
          />
        ))}
      </section>
    </div>
  );
};
