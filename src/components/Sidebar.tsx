import React from "react";
import { useTranslation } from "react-i18next";
import ElchiLogo from "./icons/ElchiLogo";
import { useSettings } from "../hooks/useSettings";
import { daysLeft, useElchiPro } from "../hooks/useElchiPro";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
  SummarySettings,
  DictionarySettings,
} from "./settings";

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface SectionConfig {
  labelKey: string;
  component: React.ComponentType;
  enabled: (settings: any) => boolean;
}

export const SECTIONS_CONFIG = {
  summary: {
    labelKey: "sidebar.summary",
    component: SummarySettings,
    enabled: () => true,
  },
  general: {
    labelKey: "sidebar.general",
    component: GeneralSettings,
    enabled: () => true,
  },
  history: {
    labelKey: "sidebar.history",
    component: HistorySettings,
    enabled: () => true,
  },
  dictionary: {
    labelKey: "sidebar.dictionary",
    component: DictionarySettings,
    enabled: () => true,
  },
  models: {
    labelKey: "sidebar.models",
    component: ModelsSettings,
    enabled: () => true,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    component: AdvancedSettings,
    enabled: () => true,
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    component: PostProcessingSettings,
    enabled: (settings) => settings?.post_process_enabled ?? false,
  },
  debug: {
    labelKey: "sidebar.debug",
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    labelKey: "sidebar.about",
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface AppHeaderProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  /** Back to the home feed (the wordmark). */
  onHome?: () => void;
}

/** The Çini tile behind the header: eight-point stars with a coral eye. */
const TilePattern: React.FC = () => (
  <svg
    className="absolute inset-0 w-full h-full pointer-events-none"
    style={{
      // The tile fades out before the tab row so the labels stay clean.
      maskImage: "linear-gradient(to bottom, black 30%, transparent 78%)",
      WebkitMaskImage: "linear-gradient(to bottom, black 30%, transparent 78%)",
    }}
    aria-hidden="true"
  >
    <defs>
      <pattern
        id="elchi-tile"
        width="56"
        height="56"
        patternUnits="userSpaceOnUse"
      >
        <path
          d="M28 4 32 16 44 12 40 24 52 28 40 32 44 44 32 40 28 52 24 40 12 44 16 32 4 28 16 24 12 12 24 16Z"
          fill="none"
          strokeWidth="1.5"
          style={{ stroke: "var(--color-tile)", opacity: 0.45 }}
        />
        <circle
          cx="28"
          cy="28"
          r="3"
          style={{ fill: "var(--color-star)", opacity: 0.45 }}
        />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#elchi-tile)" />
  </svg>
);

/** The plan at a glance: trial days left, Elchi Pro, or the upgrade offer. */
const PlanBadge: React.FC = () => {
  const { t } = useTranslation();
  const { status, upgrade } = useElchiPro();
  if (!status?.plan) return null;
  if (status.plan === "free") {
    return (
      <button
        type="button"
        onClick={() => upgrade().catch(() => undefined)}
        className="relative text-sm font-semibold rounded-full px-4 py-1.5 bg-coral text-on-coral hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-on-header"
      >
        {t("elchiPro.cta")}
      </button>
    );
  }
  const label =
    status.plan === "pro"
      ? t("elchiPro.badge.pro")
      : t("elchiPro.badge.trial", {
          count: daysLeft(status.trial_ends_at) ?? 0,
        });
  return (
    <span className="relative text-sm font-semibold rounded-full px-3.5 py-1.5 bg-background text-logo-primary">
      {label}
    </span>
  );
};

/**
 * Çini header: the tile band with the wordmark, the plan badge and the
 * section tabs, the active tab opening into the page below.
 */
export const AppHeader: React.FC<AppHeaderProps> = ({
  activeSection,
  onSectionChange,
  onHome,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled(settings))
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  return (
    <header className="relative shrink-0 bg-header text-on-header overflow-hidden">
      <TilePattern />
      <div className="relative flex items-center gap-3 px-6 pt-4">
        <button
          type="button"
          onClick={onHome}
          title={t("home.home")}
          aria-label={t("home.home")}
          className="inline-flex items-center gap-2 rounded-lg -ml-1 px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-on-header"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            ←
          </span>
          <ElchiLogo size={22} color="var(--color-on-header)" />
        </button>
        <div className="flex-1" />
        <PlanBadge />
      </div>
      <nav
        role="tablist"
        aria-label={t("sidebar.label")}
        className="relative flex gap-1 px-4 mt-4 overflow-x-auto [scrollbar-width:none]"
      >
        {availableSections.map((section) => {
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSectionChange(section.id)}
              className={`shrink-0 text-sm px-4 py-2.5 rounded-t-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tile ${
                isActive
                  ? "bg-background text-logo-primary font-semibold"
                  : "text-on-header-muted hover:text-on-header"
              }`}
            >
              {t(section.labelKey)}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
