import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands, type ElchiProInfo } from "@/bindings";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { ToggleSwitch } from "../../ui/ToggleSwitch";

const BENCHMARKS_URL = "https://speech.patientdesk.ai/duyu";

/**
 * Elchi Pro upsell: dictation with Duyu, the full cloud model. Off by
 * default; with a key connected the user can switch it on and off, and the
 * on-device Duyu-small takes over whenever the cloud is unreachable.
 */
export const ElchiProCard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [info, setInfo] = useState<ElchiProInfo | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInfo(await commands.getElchiProInfo());
    } catch (e) {
      console.error("Failed to load Elchi Pro state:", e);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!info) return null;

  const price = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "TRY",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(info.price_try_monthly);

  const connect = async () => {
    setBusy(true);
    setError(null);
    const result = await commands.connectElchiPro(apiKey);
    setBusy(false);
    if (result.status === "error") {
      setError(result.error);
      return;
    }
    setApiKey("");
    setShowKeyForm(false);
    refresh();
  };

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    const result = await commands.setElchiProEnabled(enabled);
    setBusy(false);
    if (result.status === "error") setError(result.error);
    refresh();
  };

  const disconnect = async () => {
    await commands.disconnectElchiPro();
    setError(null);
    refresh();
  };

  return (
    <section
      aria-labelledby="elchi-pro-title"
      className="rounded-xl border border-logo-primary/40 bg-logo-primary/5 p-4 space-y-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-logo-primary">
            {t("settings.models.pro.eyebrow")}
          </p>
          <h2 id="elchi-pro-title" className="text-lg font-semibold">
            {t("settings.models.pro.title")}
          </h2>
        </div>
        <div className="shrink-0">
          <p className="text-lg font-semibold tabular-nums">
            {t("settings.models.pro.pricePerMonth", { price })}
          </p>
          <p className="text-xs text-text/70">
            {t("settings.models.pro.freeMonth")}
          </p>
        </div>
      </div>

      <p className="text-sm text-text/80">{t("settings.models.pro.body")}</p>

      {info.has_key ? (
        <div className="space-y-2">
          <ToggleSwitch
            checked={info.enabled}
            onChange={toggle}
            isUpdating={busy}
            label={t("settings.models.pro.useCloud")}
            description={t("settings.models.pro.useCloudDescription")}
            descriptionMode="inline"
          />
          <Button variant="ghost" size="sm" onClick={disconnect}>
            {t("settings.models.pro.disconnect")}
          </Button>
        </div>
      ) : showKeyForm ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) connect();
          }}
        >
          <label htmlFor="elchi-pro-key" className="block text-sm font-medium">
            {t("settings.models.pro.keyLabel")}
          </label>
          <div className="flex gap-2">
            <Input
              id="elchi-pro-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="pd_live_…"
              className="flex-1 font-mono"
            />
            <Button type="submit" disabled={busy || !apiKey.trim()}>
              {busy
                ? t("settings.models.pro.connecting")
                : t("settings.models.pro.connect")}
            </Button>
          </div>
          <p className="text-xs text-text/70">
            {t("settings.models.pro.keyHelp")}{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-logo-primary"
              onClick={() => openUrl(info.keys_url)}
            >
              {t("settings.models.pro.keyHelpLink")}
            </button>
          </p>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => openUrl(info.signup_url)}>
            {t("settings.models.pro.startFree")}
          </Button>
          <Button variant="secondary" onClick={() => setShowKeyForm(true)}>
            {t("settings.models.pro.haveKey")}
          </Button>
          <button
            type="button"
            className="text-sm underline underline-offset-2 text-text/70 hover:text-logo-primary"
            onClick={() => openUrl(BENCHMARKS_URL)}
          >
            {t("settings.models.pro.benchmarks")}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <p className="text-xs text-text/70 border-t border-mid-gray/20 pt-2">
        {t("settings.models.pro.privacy")}
      </p>
    </section>
  );
};
