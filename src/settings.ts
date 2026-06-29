import {
  App,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  normalizePath,
} from "obsidian";
import type TraktrPlugin from "./main";
import { getTranslator, type StringKey, type UiLanguage } from "./strings";
import { dedupeDuplicateNotes } from "./sync-engine";
import {
  EMPTY_HISTORY_STATE,
  type HistoryState,
  type TmdbCache,
} from "./types";
import { clearTmdbCache, tmdbCacheStats, verifyTmdbApiKey } from "./tmdb-api";
import { clearHistoryState, historyStateStats } from "./history-state";
import {
  manualBackfill,
  renderPreview,
  computeDailyNotePath,
  daysBetweenISO,
  addDaysISO,
  localTodayISODate,
  computeThisMonth,
  computeLastMonth,
  type DailyNotesHost,
} from "./daily-notes";
import {
  BASE_DISPLAY_FIELD_DEFINITIONS,
  BASE_FIELD_GROUPS,
  BASE_FILE_KINDS,
  BaseFileError,
  createDefaultBaseDisplayFields,
  getBaseDisplayFields,
  getBaseFileDefinitions,
  getResolvedBaseDisplaySettings,
  writeBaseFile,
  type BaseDisplayField,
  type BaseDisplaySettings,
  type BaseFieldGroup,
  type BaseFileKind,
} from "./bases";

export const POSTER_SIZES = [
  "w92",
  "w154",
  "w185",
  "w342",
  "w500",
  "w780",
  "original",
] as const;

export type PosterSize = (typeof POSTER_SIZES)[number];

export const BUILD_CREATED_AT = "2026-05-21 15:35:00 PDT";

/**
 * [0.5.0] Settings that can be marked as "device-local" per spec 0003.
 *
 * These are the settings whose semantics make per-device divergence
 * legitimate — auto-sync timing varies by device, UI language can vary
 * by user-of-device, etc. Everything else (auth tokens, sync content
 * toggles, metadata language, templates, etc.) always lives in data.json
 * and follows vault sync.
 *
 * Each device independently records WHICH of these keys are local on it
 * (the `_localKeys` array in localStorage). This means Mac can have
 * `uiLanguage` local while iPhone keeps it synced — the metadata about
 * who's local is itself device-local, not synced.
 */
export const LOCAL_ELIGIBLE_KEYS = [
  "syncOnStartup",
  "autoSyncEnabled",
  "autoSyncIntervalMinutes",
  "dailyNotesAutoSyncEnabled",
  "dailyNotesAutoSyncIntervalMinutes",
  "uiLanguage",
] as const;
export type LocalEligibleKey = (typeof LOCAL_ELIGIBLE_KEYS)[number];

/**
 * [0.5.0] On first 0.5.0 launch (no `_localKeys` in localStorage yet),
 * these keys default to local on that device. The auto-sync trio fits
 * here because cross-device sync of these settings causes redundant
 * syncs / Trakt API traffic for zero user benefit (each device should
 * pick its own cadence). `uiLanguage` defaults to SYNCED — most users
 * want the same UI language everywhere — but it remains togglable via
 * the cloud icon.
 */
export const DEFAULT_LOCAL_KEYS: ReadonlyArray<LocalEligibleKey> = [
  "syncOnStartup",
  "autoSyncEnabled",
  "autoSyncIntervalMinutes",
  "dailyNotesAutoSyncEnabled",
  "dailyNotesAutoSyncIntervalMinutes",
];

export const DEFAULT_LOCAL_KEYS_ADDED_IN_SCHEMA_2: ReadonlyArray<LocalEligibleKey> = [
  "dailyNotesAutoSyncEnabled",
  "dailyNotesAutoSyncIntervalMinutes",
];

export type ConfirmDangerousActionOptions = {
  title: StringKey;
  body: StringKey;
  confirm: StringKey;
  vars?: Record<string, string | number>;
};

class ConfirmDangerousActionModal extends Modal {
  private translate: ReturnType<typeof getTranslator>;
  private options: ConfirmDangerousActionOptions;
  private resolve: (confirmed: boolean) => void;
  private settled = false;

  constructor(
    app: App,
    translate: ReturnType<typeof getTranslator>,
    options: ConfirmDangerousActionOptions,
    resolve: (confirmed: boolean) => void,
  ) {
    super(app);
    this.translate = translate;
    this.options = options;
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.translate(this.options.title, this.options.vars));

    const body = contentEl.createDiv({ cls: "trakt-confirm-body" });
    const bodyText = this.translate(this.options.body, this.options.vars);
    for (const para of bodyText.split("\n")) {
      if (para.trim() === "") continue;
      body.createEl("p", { text: para });
    }

    const btnContainer = contentEl.createDiv({ cls: "trakt-modal-buttons" });
    const cancelBtn = btnContainer.createEl("button", {
      text: this.translate("confirm.cancel"),
    });
    cancelBtn.onclick = () => this.finish(false);

    const confirmBtn = btnContainer.createEl("button", {
      text: this.translate(this.options.confirm, this.options.vars),
      cls: "mod-warning",
    });
    confirmBtn.onclick = () => this.finish(true);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(false);
    }
  }

  private finish(confirmed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(confirmed);
    this.close();
  }
}

export function confirmDangerousAction(
  app: App,
  translate: ReturnType<typeof getTranslator>,
  options: ConfirmDangerousActionOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmDangerousActionModal(app, translate, options, resolve).open();
  });
}

/**
 * Namespace prefix for all localStorage keys this plugin owns. Obsidian's
 * `app.loadLocalStorage` / `saveLocalStorage` are vault-scoped, but the
 * prefix lets us coexist with other plugins (and our own future keys)
 * within the same vault's local storage.
 */
export const LOCAL_STORAGE_PREFIX = "sync-trakt:";

/** Key under which the list of currently-local setting keys is stored. */
export const LOCAL_KEYS_STORAGE_KEY = `${LOCAL_STORAGE_PREFIX}_localKeys`;

/**
 * Version marker for one-time migrations of the device-local key list.
 * Schema 1 was implicit in 0.5.x. Schema 2 adds the 1.2.x Daily Notes
 * timer keys to existing installs without re-adding them after a user
 * later chooses to sync those settings.
 */
export const LOCAL_KEYS_SCHEMA_VERSION = 2;
export const LOCAL_KEYS_SCHEMA_STORAGE_KEY = `${LOCAL_STORAGE_PREFIX}_localKeysSchemaVersion`;

/** Preset language options shown in the Localization (metadata) dropdown.
 * The Note template language dropdown reuses this same list for symmetry,
 * even though the plugin only ships translated default templates for English
 * and Simplified/Traditional Chinese (other codes resolve to the English
 * default — users can still customize manually). */
export interface TraktrSettings {
  // Authentication
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;

  // TMDB
  tmdbApiKey: string;
  posterSize: PosterSize;

  // [1.0.0] When true, every sync compares each existing note's filename
  // against what the current title + filename-template would produce, and
  // renames via app.fileManager.renameFile (which auto-updates internal
  // Obsidian links). Default true to honour the long-broken description
  // text that already promised this behaviour. Users who'd rather rename
  // manually flip this off. See spec 0009.
  autoRenameOnLanguageChange: boolean;
  uiLanguage: UiLanguage;

  // Property namespace
  propertyPrefix: string;

  // Folders & file naming
  folder: string;
  basesFolder: string;
  basesDisplayFields: BaseDisplaySettings;
  filenameTemplate: string;

  // Note templates
  movieNoteTemplate: string;
  showNoteTemplate: string;

  // Tags
  addTags: boolean;
  tagPrefix: string;

  // Tag notes
  addTagNotes: boolean;
  createTagNotes: boolean;
  tagNotesFolder: string;

  // Sync sources
  // syncWatched: pulls /sync/watched/* — provides plays count + last
  //   watched timestamp per item.
  // syncWatchedDetail: layered on top, additionally pulls /sync/history to
  //   render per-watch timestamps in the note body via {{watch_history}}.
  //   This endpoint can be very large; off by default.
  syncWatchlist: boolean;
  syncFavorites: boolean;
  syncWatched: boolean;
  syncWatchedDetail: boolean;
  syncRatings: boolean;

  // Sync behavior
  syncMovies: boolean;
  syncShows: boolean;
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
  syncOnStartup: boolean;
  overwriteExisting: boolean;
  deleteRemovedItems: boolean;
  communityStatsUpdatePolicy: CommunityStatsUpdatePolicy;
  communityStatsRefreshIntervalDays: number;
  communityRatingChangeThreshold: number;
  communityVotesChangeThresholdPercent: number;

  // ── [0.2.0] TMDB cache ──
  // Persistent across syncs and across devices (lives in data.json which
  // follows the user's vault sync layer). Keyed by
  // `${type}:${tmdbId}:${language || 'default'}` so each (item, language)
  // combination has its own slot.
  tmdbCache: TmdbCache;
  // 0 = never expire. Otherwise the configured days, ±5 days jitter per
  // entry to avoid 1000+ entries all expiring on the same day.
  tmdbCacheTtlDays: number;

  // ── [0.2.0] History state for incremental Trakt history sync ──
  // Only meaningful when syncWatchedDetail is on. Stores aggregated
  // watch events plus the set of every event id we've already seen,
  // letting subsequent syncs do `?start_at=lastIncrementalSyncAt`
  // instead of pulling the full history every time.
  historyState: HistoryState;
  // Periodic full refresh to catch deletions on Trakt's side that an
  // incremental fetch can't see. Default 7 days.
  historyFullRefreshIntervalDays: number;

  // ── [0.7.0] Daily Notes integration ──
  // Auto-inject per-event lines into the user's Daily Note for each
  // sync. Safety contract: never modify content outside the marker
  // region. See spec 0006 for full design + 26-row edge case matrix.
  dailyNotesEnabled: boolean;
  dailyNotesFolder: string;             // e.g. "Daily" or "01 Daily"
  dailyNotesFilenameFormat: string;     // Moment.js, e.g. "YYYY-MM-DD"
  dailyNotesMarkerStart: string;        // default: "%% trakt:daily:start %%"
  dailyNotesMarkerEnd: string;          // default: "%% trakt:daily:end %%"
  dailyNotesAutoSyncEnabled: boolean;
  dailyNotesAutoSyncIntervalMinutes: number;
  // [1.0.0] Removed: dailyNotesBackfillDays. Backfill UI is now a
  // date-range modal (BackfillRangeModal) — there's no persistent
  // "default N days" preference any more. Old values in users'
  // data.json are simply ignored by Object.assign(DEFAULT_SETTINGS, …).
  // [0.8.0] Today-mode write strategy. "default" = full re-render every
  // sync (legacy behaviour, always reflects current Trakt state).
  // "incremental" = preserve existing lines, append-only (protects user
  // edits, doesn't propagate Trakt-side mutations). See spec docs +
  // settings-tab comparison table.
  dailyNotesSyncMode: DailyNotesSyncMode;
}

export type DailyNotesSyncMode = "default" | "incremental";
export type CommunityStatsUpdatePolicy = "every_sync" | "smart";

export const DEFAULT_MOVIE_TEMPLATE_EN = `![poster]({{poster_url}})

> {{tagline}}

## Overview
{{overview}}

## Details
- **Runtime**: {{runtime}} min
- **Genres**: {{genres}}
- **Rating**: {{trakt_rating}}/10 ({{trakt_votes}} votes)
- **Certification**: {{certification}}
- **Released**: {{released}}

## Trakt Status
- **Watchlist**: {{watchlist}}
- **Watched**: {{watched}} ({{plays}} plays, last: {{last_watched_at}})
- **Favorite**: {{favorite}}
- **My Rating**: {{my_rating}}/10

{{watch_history}}

## Links
- [Trakt]({{trakt_url}})
- [IMDB]({{imdb_url}})

## My Notes

`;

export const DEFAULT_SHOW_TEMPLATE_EN = `![poster]({{poster_url}})

## Overview
{{overview}}

## Details
- **Network**: {{network}}
- **Runtime**: {{runtime}} min per episode
- **Episodes**: {{aired_episodes}} aired
- **Genres**: {{genres}}
- **Rating**: {{trakt_rating}}/10 ({{trakt_votes}} votes)
- **Certification**: {{certification}}
- **Status**: {{status}}
- **First Aired**: {{first_aired}}

## Trakt Status
- **Watchlist**: {{watchlist}}
- **Watched**: {{watched}} ({{plays}} plays, last: {{last_watched_at}})
- **Favorite**: {{favorite}}
- **My Rating**: {{my_rating}}/10

{{watch_history}}

## Links
- [Trakt]({{trakt_url}})
- [IMDB]({{imdb_url}})

## My Notes

`;

export const DEFAULT_MOVIE_TEMPLATE = DEFAULT_MOVIE_TEMPLATE_EN;
export const DEFAULT_SHOW_TEMPLATE = DEFAULT_SHOW_TEMPLATE_EN;

export const DEFAULT_SETTINGS: TraktrSettings = {
  clientId: "",
  clientSecret: "",
  accessToken: "",
  refreshToken: "",
  tokenExpiresAt: 0,

  tmdbApiKey: "",
  posterSize: "w500",

  autoRenameOnLanguageChange: true,
  uiLanguage: "en",

  propertyPrefix: "trakt_",

  folder: "trakt",
  basesFolder: "Bases",
  basesDisplayFields: createDefaultBaseDisplayFields(),
  filenameTemplate: "{{title}} ({{year}})",

  movieNoteTemplate: DEFAULT_MOVIE_TEMPLATE_EN,
  showNoteTemplate: DEFAULT_SHOW_TEMPLATE_EN,

  addTags: true,
  tagPrefix: "trakt",

  addTagNotes: false,
  createTagNotes: false,
  tagNotesFolder: "trakt",

  syncWatchlist: true,
  syncFavorites: true,
  syncWatched: false,
  syncWatchedDetail: false,
  syncRatings: false,

  syncMovies: true,
  syncShows: true,
  autoSyncEnabled: false,
  autoSyncIntervalMinutes: 60,
  syncOnStartup: false,
  overwriteExisting: false,
  deleteRemovedItems: false,
  communityStatsUpdatePolicy: "smart",
  communityStatsRefreshIntervalDays: 7,
  communityRatingChangeThreshold: 0.1,
  communityVotesChangeThresholdPercent: 5,

  // [0.2.0] TMDB cache + history state defaults
  tmdbCache: {},
  tmdbCacheTtlDays: 90,
  historyState: { ...EMPTY_HISTORY_STATE },
  historyFullRefreshIntervalDays: 7,

  // [0.7.0] Daily Notes — disabled by default; user opts in via the
  // Daily Notes tab. See spec 0006 §"Defaults".
  dailyNotesEnabled: false,
  dailyNotesFolder: "Daily",
  dailyNotesFilenameFormat: "YYYY-MM-DD",
  dailyNotesMarkerStart: "%% trakt:daily:start %%",
  dailyNotesMarkerEnd: "%% trakt:daily:end %%",
  dailyNotesAutoSyncEnabled: false,
  dailyNotesAutoSyncIntervalMinutes: 60,
  dailyNotesSyncMode: "default",
};

/**
 * [0.6.0] Settings page tab ids — see spec 0005. Persisted per-device
 * in localStorage so each Mac/iPhone remembers its own last-viewed tab.
 */
export type SettingsTabId =
  | "general"
  | "notes"
  | "bases"
  | "sync"
  | "daily";
const SETTINGS_TABS: ReadonlyArray<SettingsTabId> = [
  "general",
  "notes",
  "bases",
  "sync",
  "daily",
];
const ACTIVE_TAB_STORAGE_KEY = "sync-trakt:_activeSettingsTab";

export class TraktrSettingTab extends PluginSettingTab {
  plugin: TraktrPlugin;
  private activeTab: SettingsTabId = "general";

  constructor(app: App, plugin: TraktrPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * [0.6.0] Render the top tab bar. Clicking switches `activeTab`,
   * persists it to localStorage, and re-renders the whole settings UI.
   * See spec 0005 §"Implementation skeleton".
   */
  private renderTabBar(parent: HTMLElement): void {
    const t = getTranslator(this.plugin.settings.uiLanguage);
    const bar = parent.createDiv({ cls: "trakt-tab-bar" });
    for (const tabId of SETTINGS_TABS) {
      const btn = bar.createEl("button", {
        cls:
          "trakt-tab" + (tabId === this.activeTab ? " is-active" : ""),
        text: t(`tabs.${tabId}`),
      });
      btn.onclick = () => {
        this.activeTab = tabId;
        this.plugin.app.saveLocalStorage(ACTIVE_TAB_STORAGE_KEY, tabId);
        this.display();
      };
    }
  }

  /** Load the active tab from localStorage, falling back to "general". */
  private loadActiveTab(): SettingsTabId {
    const raw: unknown = this.plugin.app.loadLocalStorage(ACTIVE_TAB_STORAGE_KEY);
    if (typeof raw === "string" && (SETTINGS_TABS as readonly string[]).includes(raw)) {
      return raw as SettingsTabId;
    }
    return "general";
  }

  /**
   * [0.5.0] Attach the per-setting cloud icon to a Setting row. The icon
   * shows whether this key is currently synced (cloud) or device-local
   * (cloud-off). Clicking toggles the state and re-renders the tab so
   * any dependent UI updates accordingly. See spec 0003.
   */
  private addLocalToggle(setting: Setting, key: LocalEligibleKey): Setting {
    const t = getTranslator(this.plugin.settings.uiLanguage);
    return setting.addExtraButton((btn) => {
      const isLocal = this.plugin.localKeys.has(key);
      btn
        .setIcon(isLocal ? "cloud-off" : "cloud")
        .setTooltip(
          isLocal
            ? t("settings.cloud.local.tooltip")
            : t("settings.cloud.synced.tooltip"),
        )
        .onClick(async () => {
          await this.plugin.setKeyIsLocal(key, !isLocal);
          this.display();
        });
    });
  }

  private confirmAction(options: ConfirmDangerousActionOptions): Promise<boolean> {
    return confirmDangerousAction(
      this.plugin.app,
      getTranslator(this.plugin.settings.uiLanguage),
      options,
    );
  }

  private async generateBases(
    kinds: ReadonlyArray<BaseFileKind>,
  ): Promise<void> {
    const t = getTranslator(this.plugin.settings.uiLanguage);
    const selected = new Set<BaseFileKind>(kinds);
    const definitions = getBaseFileDefinitions(this.plugin.settings).filter(
      (definition) => selected.has(definition.kind),
    );

    for (const definition of definitions) {
      try {
        const result = await writeBaseFile(
          this.plugin.app,
          this.plugin.settings.basesFolder,
          definition,
          (path) =>
            this.confirmAction({
              title: "bases.confirmOverwrite.title",
              body: "bases.confirmOverwrite.body",
              confirm: "bases.confirmOverwrite.confirm",
              vars: { filename: definition.filename, path },
            }),
        );
        const key =
          result.status === "created"
            ? "bases.notice.created"
            : result.status === "updated"
              ? "bases.notice.updated"
              : "bases.notice.skipped";
        new Notice(
          t(key, { filename: definition.filename, path: result.path }),
          5000,
        );
      } catch (error) {
        const msg =
          error instanceof BaseFileError
            ? t(
                error.code === "folder_path_is_file"
                  ? "bases.error.folderPathIsFile"
                  : "bases.error.targetIsNotFile",
                { path: error.path },
              )
            : error instanceof Error
              ? error.message
              : String(error);
        new Notice(
          t("bases.notice.failed", { filename: definition.filename, msg }),
          10000,
        );
      }
    }
  }

  private async setBaseDisplayFields(
    kind: BaseFileKind,
    fields: ReadonlyArray<BaseDisplayField>,
  ): Promise<void> {
    const selected = new Set(fields);
    const canonical = BASE_DISPLAY_FIELD_DEFINITIONS.filter((field) =>
      selected.has(field.id),
    ).map((field) => field.id);
    this.plugin.settings.basesDisplayFields = {
      ...getResolvedBaseDisplaySettings(this.plugin.settings),
      [kind]: canonical,
    };
    await this.plugin.saveSettings();
  }

  private baseKindNameKey(kind: BaseFileKind): StringKey {
    const keys: Record<BaseFileKind, StringKey> = {
      library: "bases.library.name",
      movies: "bases.movies.name",
      shows: "bases.shows.name",
      watchlist: "bases.watchlist.name",
      watched: "bases.watched.name",
      ratings: "bases.ratings.name",
    };
    return keys[kind];
  }

  private baseFieldGroupKey(group: BaseFieldGroup): StringKey {
    const keys: Record<BaseFieldGroup, StringKey> = {
      core: "bases.group.core",
      ratings: "bases.group.ratings",
      activity: "bases.group.activity",
      progress: "bases.group.progress",
      release: "bases.group.release",
      links: "bases.group.links",
      sync: "bases.group.sync",
    };
    return keys[group];
  }

  private renderBaseFieldChooser(
    containerEl: HTMLElement,
    kind: BaseFileKind,
    t: ReturnType<typeof getTranslator>,
  ): void {
    const details = containerEl.createEl("details", {
      cls: "trakt-bases-field-panel",
    });
    const summary = details.createEl("summary");
    summary.createSpan({ text: t(this.baseKindNameKey(kind)) });
    const countEl = summary.createSpan({ cls: "trakt-bases-field-count" });
    const controls = details.createDiv({ cls: "trakt-bases-field-controls" });
    const checkboxes = new Map<BaseDisplayField, HTMLInputElement>();
    let selected = new Set(getBaseDisplayFields(this.plugin.settings, kind));

    const updateCount = (): void => {
      countEl.setText(
        t("bases.fields.selectedCount", { count: selected.size }),
      );
    };

    const applySelection = async (
      fields: ReadonlyArray<BaseDisplayField>,
    ): Promise<void> => {
      selected = new Set(fields);
      for (const [id, checkbox] of checkboxes) {
        checkbox.checked = selected.has(id);
      }
      updateCount();
      await this.setBaseDisplayFields(kind, fields);
    };

    const addPresetButton = (
      label: StringKey,
      fields: () => ReadonlyArray<BaseDisplayField>,
    ): void => {
      const button = controls.createEl("button", { text: t(label) });
      button.onclick = () => {
        void applySelection(fields());
      };
    };

    addPresetButton(
      "bases.fields.recommended",
      () => createDefaultBaseDisplayFields()[kind],
    );
    addPresetButton(
      "bases.fields.all",
      () => BASE_DISPLAY_FIELD_DEFINITIONS.map((field) => field.id),
    );
    addPresetButton("bases.fields.none", () => []);

    for (const group of BASE_FIELD_GROUPS) {
      const groupFields = BASE_DISPLAY_FIELD_DEFINITIONS.filter(
        (field) => field.group === group,
      );
      const section = details.createDiv({ cls: "trakt-bases-field-section" });
      section.createDiv({
        cls: "trakt-bases-field-section-title",
        text: t(this.baseFieldGroupKey(group)),
      });
      const grid = section.createDiv({ cls: "trakt-bases-field-grid" });

      for (const field of groupFields) {
        const label = grid.createEl("label", {
          cls: "trakt-bases-field-option",
        });
        const checkbox = label.createEl("input", { type: "checkbox" });
        checkbox.checked = selected.has(field.id);
        checkboxes.set(field.id, checkbox);
        label.createSpan({ text: t(field.labelKey) });
        checkbox.onchange = () => {
          if (checkbox.checked) selected.add(field.id);
          else selected.delete(field.id);
          updateCount();
          void this.setBaseDisplayFields(kind, [...selected]);
        };
      }
    }

    updateCount();
  }

  private renderBasesTab(
    containerEl: HTMLElement,
    t: ReturnType<typeof getTranslator>,
  ): void {
    new Setting(containerEl)
      .setName(t("bases.heading"))
      .setDesc(t("bases.help"))
      .setHeading();

    new Setting(containerEl)
      .setName(t("bases.folder.name"))
      .setDesc(t("bases.folder.desc"))
      .addText((text) =>
        text
          .setPlaceholder("Bases")
          .setValue(this.plugin.settings.basesFolder)
          .onChange(async (value) => {
            this.plugin.settings.basesFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    const addCreateRow = (
      name: StringKey,
      desc: StringKey,
      buttonText: StringKey,
      kinds: ReadonlyArray<BaseFileKind>,
      cta = false,
    ): void => {
      new Setting(containerEl)
        .setName(t(name))
        .setDesc(t(desc))
        .addButton((btn) => {
          btn.setButtonText(t(buttonText));
          if (cta) btn.setCta();
          btn.onClick(async () => {
            btn.setDisabled(true);
            try {
              await this.generateBases(kinds);
            } finally {
              btn.setDisabled(false);
            }
          });
        });
    };

    new Setting(containerEl)
      .setName(t("bases.fields.heading"))
      .setDesc(t("bases.fields.desc"))
      .setHeading();

    for (const kind of BASE_FILE_KINDS) {
      this.renderBaseFieldChooser(containerEl, kind, t);
    }

    new Setting(containerEl).setName(t("bases.actions.heading")).setHeading();

    addCreateRow(
      "bases.library.name",
      "bases.library.desc",
      "bases.createLibrary",
      ["library"],
      true,
    );
    addCreateRow(
      "bases.movies.name",
      "bases.movies.desc",
      "bases.createMovies",
      ["movies"],
    );
    addCreateRow(
      "bases.shows.name",
      "bases.shows.desc",
      "bases.createShows",
      ["shows"],
    );
    addCreateRow(
      "bases.watchlist.name",
      "bases.watchlist.desc",
      "bases.createWatchlist",
      ["watchlist"],
    );
    addCreateRow(
      "bases.watched.name",
      "bases.watched.desc",
      "bases.createWatched",
      ["watched"],
    );
    addCreateRow(
      "bases.ratings.name",
      "bases.ratings.desc",
      "bases.createRatings",
      ["ratings"],
    );
    addCreateRow(
      "bases.all.name",
      "bases.all.desc",
      "bases.createAll",
      ["movies", "shows", "watchlist", "watched", "ratings", "library"],
      true,
    );

  }

  /**
   * [0.7.0] Render the Daily Notes tab (spec 0006). Contains:
   *   - Enable toggle
   *   - Folder + filename format
   *   - Marker start / end strings
   *   - Live preview of 3 sample events
   *   - Source events reference table
   *   - Manual backfill slider + button (with confirmation modal)
   */
  private renderDailyNotesTab(
    containerEl: HTMLElement,
    t: ReturnType<typeof getTranslator>,
  ): void {
    new Setting(containerEl).setName(t("daily.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("daily.enabled.name"))
      .setDesc(t("daily.enabled.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.dailyNotesEnabled)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.configureDailyNotesAutoSync();
            this.display();
          }),
      );

    if (!this.plugin.settings.dailyNotesEnabled) return;

    new Setting(containerEl)
      .setName(t("daily.folder.name"))
      .setDesc(t("daily.folder.desc"))
      .addText((text) =>
        text
          .setPlaceholder("Daily")
          .setValue(this.plugin.settings.dailyNotesFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("daily.format.name"))
      .setDesc(t("daily.format.desc"))
      .addText((text) =>
        // [0.8.1] No placeholder — the description already shows
        // YYYY-MM-DD as the canonical example, and the field is
        // pre-filled with the default format, so the placeholder
        // rarely surfaces. Avoids tripping the sentence-case lint
        // rule (which we're not allowed to disable per Obsidian's
        // directory submission rules).
        text
          .setValue(this.plugin.settings.dailyNotesFilenameFormat)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesFilenameFormat = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("daily.markerStart.name"))
      .setDesc(t("daily.marker.desc"))
      .addText((text) =>
        text
          .setPlaceholder("%% trakt:daily:start %%")
          .setValue(this.plugin.settings.dailyNotesMarkerStart)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesMarkerStart = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("daily.markerEnd.name"))
      .addText((text) =>
        text
          .setPlaceholder("%% trakt:daily:end %%")
          .setValue(this.plugin.settings.dailyNotesMarkerEnd)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesMarkerEnd = value;
            await this.plugin.saveSettings();
          }),
      );

    // Warning about not editing inside markers — stays in settings, never
    // injected into Daily Note itself (per user feedback during spec review).
    const warningEl = containerEl.createDiv({ cls: "trakt-daily-warning" });
    warningEl.setText(t("daily.warning"));

    // Live preview
    new Setting(containerEl)
      .setName(t("daily.preview.name"))
      .setDesc(t("daily.preview.desc"));
    const previewEl = containerEl.createDiv({ cls: "trakt-daily-preview" });
    previewEl.setText(renderPreview(this.plugin.settings));

    // Source events reference (static help text)
    new Setting(containerEl).setName(t("daily.sources.heading")).setHeading();
    new Setting(containerEl).setDesc(t("daily.sources.desc"));
    const sourcesEl = containerEl.createDiv({ cls: "trakt-daily-sources" });
    const sources = [
      "daily.sources.watched",
      "daily.sources.watchlist",
      "daily.sources.favorites",
      "daily.sources.ratings",
    ] as const;
    for (const key of sources) {
      const line = sourcesEl.createEl("div");
      line.setText("• " + t(key));
    }

    new Setting(containerEl).setName(t("daily.autoSync.heading")).setHeading();

    this.addLocalToggle(
      new Setting(containerEl)
        .setName(t("daily.autoSync.name"))
        .setDesc(t("daily.autoSync.desc"))
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.dailyNotesAutoSyncEnabled)
            .onChange(async (value) => {
              this.plugin.settings.dailyNotesAutoSyncEnabled = value;
              await this.plugin.saveSettings();
              this.plugin.configureDailyNotesAutoSync();
              this.display();
            }),
        ),
      "dailyNotesAutoSyncEnabled",
    );

    if (this.plugin.settings.dailyNotesAutoSyncEnabled) {
      this.addLocalToggle(
        new Setting(containerEl)
          .setName(t("daily.autoSync.interval.name"))
          .setDesc(t("daily.autoSync.interval.desc"))
          .addSlider((slider) =>
            slider
              .setLimits(5, 360, 5)
              .setValue(this.plugin.settings.dailyNotesAutoSyncIntervalMinutes)
              .setDynamicTooltip()
              .onChange(async (value) => {
                this.plugin.settings.dailyNotesAutoSyncIntervalMinutes = value;
                await this.plugin.saveSettings();
                this.plugin.configureDailyNotesAutoSync();
              }),
          ),
        "dailyNotesAutoSyncIntervalMinutes",
      );
    }

    // Manual backfill — slider + button + modal
    new Setting(containerEl).setName(t("daily.backfill.heading")).setHeading();

    // [1.0.0] Single button → date-range modal. Replaces the 0.7.0
    // slider + 1.0.0 N-days text input. The modal lets the user pick
    // any start/end pair, with quick-preset buttons for common ranges.
    new Setting(containerEl)
      .setName(t("daily.backfill.modal.title"))
      .setDesc(t("daily.backfill.button.desc"))
      .addButton((btn) =>
        btn.setButtonText(t("daily.backfill.button")).onClick(() => {
          new BackfillRangeModal(
            this.plugin.app,
            this.plugin.settings,
            t,
            async (fromDate, toDate) => {
              const refreshed =
                await this.plugin.refreshDailyNotesDataSnapshotWithProgress();
              if (!refreshed) return;

              const host: DailyNotesHost = {
                app: this.plugin.app,
                settings: this.plugin.settings,
                saveSettings: () => this.plugin.saveSettings(),
                // Backfill uses the freshly refreshed Daily Notes snapshot so
                // it follows the current Sync source toggles.
                getMergedItems: () => this.plugin.lastMergedItems ?? [],
              };
              const { wrote, skipped } = await manualBackfill(
                host,
                fromDate,
                toDate,
              );
              new Notice(t("daily.backfill.done", { wrote, skipped }), 8000);
            },
          ).open();
        }),
      );

    // [0.8.0] Sync mode selector + comparison table. Lives at the bottom
    // of the Daily Notes tab so users have all other config decided
    // before they pick the write strategy.
    new Setting(containerEl).setName(t("daily.syncMode.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("daily.syncMode.name"))
      .setDesc(t("daily.syncMode.desc"))
      .addDropdown((dd) =>
        dd
          .addOption("default", t("daily.syncMode.default"))
          .addOption("incremental", t("daily.syncMode.incremental"))
          .setValue(this.plugin.settings.dailyNotesSyncMode)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesSyncMode =
              value === "incremental" ? "incremental" : "default";
            await this.plugin.saveSettings();
          }),
      );

    // Comparison table — built with DOM API so cell text goes through
    // i18n. The row keys mirror the table in the design discussion.
    const tableRows: ReadonlyArray<{
      scenario: string;
      defaultCell: string;
      incrementalCell: string;
    }> = [
      {
        scenario: t("daily.syncMode.table.row.append.scenario"),
        defaultCell: t("daily.syncMode.table.row.append.default"),
        incrementalCell: t("daily.syncMode.table.row.append.incremental"),
      },
      {
        scenario: t("daily.syncMode.table.row.insert.scenario"),
        defaultCell: t("daily.syncMode.table.row.insert.default"),
        incrementalCell: t("daily.syncMode.table.row.insert.incremental"),
      },
      {
        scenario: t("daily.syncMode.table.row.delete.scenario"),
        defaultCell: t("daily.syncMode.table.row.delete.default"),
        incrementalCell: t("daily.syncMode.table.row.delete.incremental"),
      },
      {
        scenario: t("daily.syncMode.table.row.edit.scenario"),
        defaultCell: t("daily.syncMode.table.row.edit.default"),
        incrementalCell: t("daily.syncMode.table.row.edit.incremental"),
      },
      {
        scenario: t("daily.syncMode.table.row.lang.scenario"),
        defaultCell: t("daily.syncMode.table.row.lang.default"),
        incrementalCell: t("daily.syncMode.table.row.lang.incremental"),
      },
      {
        scenario: t("daily.syncMode.table.row.rating.scenario"),
        defaultCell: t("daily.syncMode.table.row.rating.default"),
        incrementalCell: t("daily.syncMode.table.row.rating.incremental"),
      },
      {
        scenario: t("daily.syncMode.table.row.removed.scenario"),
        defaultCell: t("daily.syncMode.table.row.removed.default"),
        incrementalCell: t("daily.syncMode.table.row.removed.incremental"),
      },
    ];

    const table = containerEl.createEl("table", {
      cls: "trakt-sync-mode-table",
    });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: t("daily.syncMode.table.col.scenario") });
    headerRow.createEl("th", { text: t("daily.syncMode.table.col.default") });
    headerRow.createEl("th", {
      text: t("daily.syncMode.table.col.incremental"),
    });
    const tbody = table.createEl("tbody");
    for (const row of tableRows) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: row.scenario });
      tr.createEl("td", { text: row.defaultCell });
      tr.createEl("td", { text: row.incrementalCell });
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const t = getTranslator(this.plugin.settings.uiLanguage);

    // [0.6.0] Tab navigation at the top — see spec 0005. The body
    // sections below are each gated by `this.activeTab` so only the
    // selected tab's content renders. Reset section (at the bottom of
    // the file) is also gated by "general" — it's logically part of the
    // General tab even though it lives at the end of display() for
    // historical reasons.
    this.activeTab = this.loadActiveTab();
    this.renderTabBar(containerEl);

    if (this.activeTab === "daily") {
      this.renderDailyNotesTab(containerEl, t);
      return;
    }

    if (this.activeTab === "bases") {
      this.renderBasesTab(containerEl, t);
      return;
    }

    if (this.activeTab === "general") {
    // [0.7.4] Version row at the top — read from manifest at render
    // time so we never have to remember to bump it here on release.
    new Setting(containerEl)
      .setName(t("plugin.version.name"))
      .setDesc(`${this.plugin.manifest.version} · ${t("plugin.version.buildDate", { date: BUILD_CREATED_AT })}`);

    // ── Authentication ──
    new Setting(containerEl).setName(t("auth.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("auth.clientId.name"))
      .setDesc(t("auth.clientId.desc"))
      .addText((text) =>
        text
          .setPlaceholder(t("auth.clientId.name"))
          .setValue(this.plugin.settings.clientId)
          .onChange(async (value) => {
            this.plugin.settings.clientId = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("auth.clientSecret.name"))
      .setDesc(t("auth.clientSecret.desc"))
      .addText((text) =>
        text
          .setPlaceholder(t("auth.clientSecret.name"))
          .setValue(this.plugin.settings.clientSecret)
          .onChange(async (value) => {
            this.plugin.settings.clientSecret = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    const connectionSetting = new Setting(containerEl).setName(
      t("auth.connection.name"),
    );

    if (this.plugin.settings.accessToken) {
      connectionSetting.setDesc(t("auth.connection.connected"));
      connectionSetting.addButton((btn) =>
        btn
          .setButtonText(t("auth.connection.disconnect"))
          .setWarning()
          .onClick(async () => {
            const confirmed = await this.confirmAction({
              title: "confirm.disconnect.title",
              body: "confirm.disconnect.body",
              confirm: "confirm.disconnect.confirm",
            });
            if (!confirmed) return;
            this.plugin.settings.accessToken = "";
            this.plugin.settings.refreshToken = "";
            this.plugin.settings.tokenExpiresAt = 0;
            await this.plugin.saveSettings();
            this.plugin.configureAutoSync();
            this.plugin.configureDailyNotesAutoSync();
            new Notice(t("auth.connection.disconnectedNotice"));
            this.display();
          }),
      );
    } else {
      connectionSetting.setDesc(t("auth.connection.notConnected"));
      connectionSetting.addButton((btn) =>
        btn
          .setButtonText(t("auth.connection.connect"))
          .setCta()
          .onClick(() => {
            if (
              !this.plugin.settings.clientId ||
              !this.plugin.settings.clientSecret
            ) {
              new Notice(t("auth.connection.needCredentialsNotice"));
              return;
            }
            this.plugin.startAuth();
            this.display();
          }),
      );
    }

    // Cross-device sync info — purely informational. The plugin doesn't
    // implement any sync itself; it relies on whatever vault-sync layer the
    // user already has (Obsidian Sync, Syncthing, iCloud, etc.). Surfacing
    // this here saves users the question "do I need to log in on every
    // device separately?".
    new Setting(containerEl)
      .setName(t("auth.sync.name"))
      .setDesc(t("auth.sync.desc"));

    // ── TMDB (poster images) ──
    new Setting(containerEl).setName(t("tmdb.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("tmdb.apiKey.name"))
      .setDesc(t("tmdb.apiKey.desc"))
      .addText((text) =>
        text
          .setPlaceholder(t("tmdb.apiKey.placeholder"))
          .setValue(this.plugin.settings.tmdbApiKey)
          .onChange(async (value) => {
            this.plugin.settings.tmdbApiKey = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    // [0.3.2] Test button — verify the key works before relying on it
    // in a real sync. Result line lives directly under the button and is
    // re-rendered on each click. Empty input short-circuits without a
    // network call (verifyTmdbApiKey handles that case explicitly).
    const testSetting = new Setting(containerEl)
      .setName(t("tmdb.apiKey.test.name"))
      .setDesc(t("tmdb.apiKey.test.desc"));
    const testResultEl = testSetting.descEl.createDiv({
      cls: "trakt-test-result",
    });
    testSetting.addButton((btn) =>
      btn.setButtonText(t("tmdb.apiKey.test.button")).onClick(async () => {
        btn.setButtonText(t("tmdb.apiKey.test.testing")).setDisabled(true);
        testResultEl.empty();
        // Reset color modifier classes from any previous click
        testResultEl.classList.remove("is-ok", "is-error", "is-muted");
        try {
          const result = await verifyTmdbApiKey(this.plugin.settings.tmdbApiKey);
          if (result.ok) {
            testResultEl.classList.add("is-ok");
            testResultEl.setText(t("tmdb.apiKey.test.ok"));
          } else {
            testResultEl.classList.add(
              result.reason === "empty" ? "is-muted" : "is-error",
            );
            const key =
              result.reason === "empty"
                ? "tmdb.apiKey.test.empty"
                : result.reason === "unauthorized"
                  ? "tmdb.apiKey.test.unauthorized"
                  : "tmdb.apiKey.test.network";
            const base = t(key);
            testResultEl.setText(
              result.detail ? `${base} (${result.detail})` : base,
            );
          }
        } finally {
          btn.setButtonText(t("tmdb.apiKey.test.button")).setDisabled(false);
        }
      }),
    );

    new Setting(containerEl)
      .setName(t("tmdb.posterSize.name"))
      .setDesc(t("tmdb.posterSize.desc"))
      .addDropdown((dd) => {
        for (const size of POSTER_SIZES) {
          dd.addOption(size, size);
        }
        dd.setValue(this.plugin.settings.posterSize);
        dd.onChange(async (value) => {
          this.plugin.settings.posterSize = value as PosterSize;
          await this.plugin.saveSettings();
        });
      });

    // [0.2.0] TMDB cache controls — TTL dropdown + manual clear button.
    // Implemented to address the "every sync re-fetches all 1000+ items"
    // bottleneck reported by users. See spec 0001 §A for design.
    const cacheStats = tmdbCacheStats(this.plugin.settings.tmdbCache);
    const cacheStatsLabel = t("tmdb.cache.entries", {
      count: cacheStats.entries,
    });

    new Setting(containerEl)
      .setName(t("tmdb.cache.ttl.name"))
      .setDesc(t("tmdb.cache.ttl.desc"))
      .addDropdown((dd) => {
        dd.addOption("0", t("tmdb.cache.ttl.never"));
        dd.addOption("7", t("tmdb.cache.ttl.7"));
        dd.addOption("30", t("tmdb.cache.ttl.30"));
        dd.addOption("90", t("tmdb.cache.ttl.90"));
        dd.addOption("365", t("tmdb.cache.ttl.365"));
        dd.setValue(String(this.plugin.settings.tmdbCacheTtlDays));
        dd.onChange(async (value) => {
          this.plugin.settings.tmdbCacheTtlDays = parseInt(value, 10) || 0;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("tmdb.cache.clear.name"))
      .setDesc(`${cacheStatsLabel}\n\n${t("tmdb.cache.clear.desc")}`)
      .addButton((btn) =>
        btn
          .setButtonText(t("tmdb.cache.clear.button"))
          .setWarning()
          .onClick(async () => {
            const confirmed = await this.confirmAction({
              title: "confirm.clearTmdb.title",
              body: "confirm.clearTmdb.body",
              confirm: "confirm.clearTmdb.confirm",
            });
            if (!confirmed) return;
            clearTmdbCache(this.plugin.settings.tmdbCache);
            await this.plugin.saveSettings();
            new Notice(t("tmdb.cache.clear.notice"));
            this.display();
          }),
      );

    }  // end of "general" tab — first half (Auth + TMDB)

    if (this.activeTab === "notes") {
    // ── Notes ──
    new Setting(containerEl).setName(t("notes.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("notes.folder.name"))
      .setDesc(t("notes.folder.desc"))
      .addText((text) =>
        text
          .setPlaceholder("Trakt")
          .setValue(this.plugin.settings.folder)
          .onChange(async (value) => {
            this.plugin.settings.folder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("notes.filename.name"))
      .setDesc(t("notes.filename.desc"))
      .addText((text) =>
        text
          .setPlaceholder("{{title}} ({{year}})")
          .setValue(this.plugin.settings.filenameTemplate)
          .onChange(async (value) => {
            this.plugin.settings.filenameTemplate = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("notes.prefix.name"))
      .setDesc(t("notes.prefix.desc"))
      .addText((text) =>
        text
          .setPlaceholder("Trakt_")
          .setValue(this.plugin.settings.propertyPrefix)
          .onChange(async (value) => {
            this.plugin.settings.propertyPrefix = value;
            await this.plugin.saveSettings();
          }),
      );

    // ── Note templates ──
    new Setting(containerEl).setName(t("templates.heading")).setHeading();

    const movieTemplateSetting = new Setting(containerEl)
      .setName(t("templates.movie.name"))
      .setDesc(t("templates.movie.desc"));
    movieTemplateSetting.addTextArea((ta) => {
      ta.inputEl.rows = 12;
      ta.inputEl.cols = 60;
      ta.setValue(this.plugin.settings.movieNoteTemplate).onChange(
        async (value) => {
          this.plugin.settings.movieNoteTemplate = value;
          await this.plugin.saveSettings();
        },
      );
    });
    movieTemplateSetting.addButton((btn) =>
      btn.setButtonText(t("templates.reset")).onClick(async () => {
        this.plugin.settings.movieNoteTemplate = DEFAULT_MOVIE_TEMPLATE;
        await this.plugin.saveSettings();
        this.display();
      }),
    );

    const showTemplateSetting = new Setting(containerEl)
      .setName(t("templates.show.name"))
      .setDesc(t("templates.show.desc"));
    showTemplateSetting.addTextArea((ta) => {
      ta.inputEl.rows = 12;
      ta.inputEl.cols = 60;
      ta.setValue(this.plugin.settings.showNoteTemplate).onChange(
        async (value) => {
          this.plugin.settings.showNoteTemplate = value;
          await this.plugin.saveSettings();
        },
      );
    });
    showTemplateSetting.addButton((btn) =>
      btn.setButtonText(t("templates.reset")).onClick(async () => {
        this.plugin.settings.showNoteTemplate = DEFAULT_SHOW_TEMPLATE;
        await this.plugin.saveSettings();
        this.display();
      }),
    );

    // ── Tags ──
    new Setting(containerEl).setName(t("tags.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("tags.add.name"))
      .setDesc(t("tags.add.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.addTags)
          .onChange(async (value) => {
            this.plugin.settings.addTags = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("tags.prefix.name"))
      .setDesc(t("tags.prefix.desc"))
      .addText((text) =>
        text
          .setPlaceholder("Trakt")
          .setValue(this.plugin.settings.tagPrefix)
          .onChange(async (value) => {
            this.plugin.settings.tagPrefix = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    // ── Tag notes ──
    new Setting(containerEl)
      .setName(t("tagNotes.heading"))
      .setDesc(t("tagNotes.heading.desc"))
      .setHeading();

    new Setting(containerEl)
      .setName(t("tagNotes.add.name"))
      .setDesc(t("tagNotes.add.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.addTagNotes)
          .onChange(async (value) => {
            this.plugin.settings.addTagNotes = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("tagNotes.create.name"))
      .setDesc(t("tagNotes.create.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.createTagNotes)
          .onChange(async (value) => {
            this.plugin.settings.createTagNotes = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("tagNotes.folder.name"))
      .setDesc(t("tagNotes.folder.desc"))
      .addText((text) =>
        text
          .setPlaceholder("Trakt")
          .setValue(this.plugin.settings.tagNotesFolder)
          .onChange(async (value) => {
            this.plugin.settings.tagNotesFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    }  // end of "notes" tab

    if (this.activeTab === "sync") {
    // ── Sync sources ──
    new Setting(containerEl).setName(t("syncSources.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("syncSources.watchlist.name"))
      .setDesc(t("syncSources.watchlist.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncWatchlist)
          .onChange(async (value) => {
            this.plugin.settings.syncWatchlist = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("syncSources.favorites.name"))
      .setDesc(t("syncSources.favorites.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncFavorites)
          .onChange(async (value) => {
            this.plugin.settings.syncFavorites = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("syncSources.watched.name"))
      .setDesc(t("syncSources.watched.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncWatched)
          .onChange(async (value) => {
            this.plugin.settings.syncWatched = value;
            // syncWatchedDetail is meaningless without syncWatched, so clear
            // it when the parent flips off — keeps settings consistent and
            // avoids surprise behavior next time syncWatched is re-enabled.
            if (!value) this.plugin.settings.syncWatchedDetail = false;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.syncWatched) {
      new Setting(containerEl)
        .setName(t("syncSources.watchedDetail.name"))
        .setDesc(t("syncSources.watchedDetail.desc"))
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.syncWatchedDetail)
            .onChange(async (value) => {
              this.plugin.settings.syncWatchedDetail = value;
              await this.plugin.saveSettings();
              this.display();
            }),
        );

      // [0.2.0] Detailed-history controls — only meaningful when detail
      // sync is on. Lets the user tune how often the plugin re-pulls the
      // full history (to detect deletions on Trakt's side that an
      // incremental fetch can't see), and shows current state stats +
      // a manual clear button.
      if (this.plugin.settings.syncWatchedDetail) {
        const historyStats = historyStateStats(
          this.plugin.settings.historyState,
        );
        const historyStatsLabel = t("history.state.stats", {
          movies: historyStats.movies,
          shows: historyStats.shows,
          events: historyStats.events,
        });

        new Setting(containerEl)
          .setName(t("history.fullRefreshInterval.name"))
          .setDesc(t("history.fullRefreshInterval.desc"))
          .addSlider((slider) =>
            slider
              .setLimits(1, 30, 1)
              .setValue(this.plugin.settings.historyFullRefreshIntervalDays)
              .setDynamicTooltip()
              .onChange(async (value) => {
                this.plugin.settings.historyFullRefreshIntervalDays = value;
                await this.plugin.saveSettings();
              }),
          );

        new Setting(containerEl)
          .setName(t("history.state.clear.name"))
          .setDesc(`${historyStatsLabel}\n\n${t("history.state.clear.desc")}`)
          .addButton((btn) =>
            btn
              .setButtonText(t("history.state.clear.button"))
              .setWarning()
              .onClick(async () => {
                const confirmed = await this.confirmAction({
                  title: "confirm.clearHistory.title",
                  body: "confirm.clearHistory.body",
                  confirm: "confirm.clearHistory.confirm",
                });
                if (!confirmed) return;
                clearHistoryState(this.plugin.settings.historyState);
                await this.plugin.saveSettings();
                new Notice(t("history.state.clear.notice"));
                this.display();
              }),
          );
      }
    }

    new Setting(containerEl)
      .setName(t("syncSources.ratings.name"))
      .setDesc(t("syncSources.ratings.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncRatings)
          .onChange(async (value) => {
            this.plugin.settings.syncRatings = value;
            await this.plugin.saveSettings();
          }),
      );

    // ── Sync behavior ──
    new Setting(containerEl).setName(t("syncBehavior.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("syncBehavior.movies.name"))
      .setDesc(t("syncBehavior.movies.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncMovies)
          .onChange(async (value) => {
            this.plugin.settings.syncMovies = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("syncBehavior.shows.name"))
      .setDesc(t("syncBehavior.shows.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncShows)
          .onChange(async (value) => {
            this.plugin.settings.syncShows = value;
            await this.plugin.saveSettings();
          }),
      );

    this.addLocalToggle(
      new Setting(containerEl)
        .setName(t("syncBehavior.startup.name"))
        .setDesc(t("syncBehavior.startup.desc"))
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.syncOnStartup)
            .onChange(async (value) => {
              this.plugin.settings.syncOnStartup = value;
              await this.plugin.saveSettings();
            }),
        ),
      "syncOnStartup",
    );

    this.addLocalToggle(
      new Setting(containerEl)
        .setName(t("syncBehavior.autoSync.name"))
        .setDesc(t("syncBehavior.autoSync.desc"))
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.autoSyncEnabled)
            .onChange(async (value) => {
              this.plugin.settings.autoSyncEnabled = value;
              await this.plugin.saveSettings();
              this.plugin.configureAutoSync();
              this.display();
            }),
        ),
      "autoSyncEnabled",
    );

    if (this.plugin.settings.autoSyncEnabled) {
      this.addLocalToggle(
        new Setting(containerEl)
          .setName(t("syncBehavior.interval.name"))
          .setDesc(t("syncBehavior.interval.desc"))
          .addSlider((slider) =>
            slider
              .setLimits(5, 360, 5)
              .setValue(this.plugin.settings.autoSyncIntervalMinutes)
              .setDynamicTooltip()
              .onChange(async (value) => {
                this.plugin.settings.autoSyncIntervalMinutes = value;
                await this.plugin.saveSettings();
                this.plugin.configureAutoSync();
              }),
          ),
        "autoSyncIntervalMinutes",
      );
    }

    new Setting(containerEl)
      .setName(t("syncBehavior.communityStats.policy.name"))
      .setDesc(t("syncBehavior.communityStats.policy.desc"))
      .addDropdown((dd) =>
        dd
          .addOption(
            "every_sync",
            t("syncBehavior.communityStats.policy.everySync"),
          )
          .addOption("smart", t("syncBehavior.communityStats.policy.smart"))
          .setValue(this.plugin.settings.communityStatsUpdatePolicy)
          .onChange(async (value) => {
            this.plugin.settings.communityStatsUpdatePolicy =
              value as CommunityStatsUpdatePolicy;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.communityStatsUpdatePolicy === "smart") {
      new Setting(containerEl)
        .setName(t("syncBehavior.communityStats.interval.name"))
        .setDesc(t("syncBehavior.communityStats.interval.desc"))
        .addSlider((slider) =>
          slider
            .setLimits(1, 30, 1)
            .setValue(this.plugin.settings.communityStatsRefreshIntervalDays)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.communityStatsRefreshIntervalDays = value;
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName(t("syncBehavior.communityStats.ratingThreshold.name"))
        .setDesc(t("syncBehavior.communityStats.ratingThreshold.desc"))
        .addText((text) =>
          text
            .setPlaceholder("0.1")
            .setValue(String(this.plugin.settings.communityRatingChangeThreshold))
            .onChange(async (value) => {
              const parsed = Number(value);
              this.plugin.settings.communityRatingChangeThreshold =
                Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.1;
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName(t("syncBehavior.communityStats.votesThreshold.name"))
        .setDesc(t("syncBehavior.communityStats.votesThreshold.desc"))
        .addSlider((slider) =>
          slider
            .setLimits(1, 100, 1)
            .setValue(
              this.plugin.settings.communityVotesChangeThresholdPercent,
            )
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.communityVotesChangeThresholdPercent =
                value;
              await this.plugin.saveSettings();
            }),
        );
    }

    new Setting(containerEl)
      .setName(t("syncBehavior.overwrite.name"))
      .setDesc(t("syncBehavior.overwrite.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.overwriteExisting)
          .onChange(async (value) => {
            this.plugin.settings.overwriteExisting = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("syncBehavior.delete.name"))
      .setDesc(t("syncBehavior.delete.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deleteRemovedItems)
          .onChange(async (value) => {
            this.plugin.settings.deleteRemovedItems = value;
            await this.plugin.saveSettings();
          }),
      );

    // ── Maintenance ──
    new Setting(containerEl).setName(t("syncMaintenance.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("syncMaintenance.dedupe.name"))
      .setDesc(t("syncMaintenance.dedupe.desc"))
      .addButton((btn) =>
        btn
          .setButtonText(t("syncMaintenance.dedupe.button"))
          .setWarning()
          .onClick(async () => {
            const tNow = getTranslator(this.plugin.settings.uiLanguage);
            const confirmed = await this.confirmAction({
              title: "confirm.dedupe.title",
              body: "confirm.dedupe.body",
              confirm: "confirm.dedupe.confirm",
            });
            if (!confirmed) return;
            btn.setButtonText(tNow("syncMaintenance.dedupe.running"));
            btn.setDisabled(true);
            try {
              const result = await dedupeDuplicateNotes(
                this.plugin.app,
                normalizePath(this.plugin.settings.folder),
                this.plugin.settings.filenameTemplate,
                this.plugin.settings.propertyPrefix,
              );
              new Notice(
                tNow("syncMaintenance.dedupe.done", {
                  groups: result.duplicateGroups,
                  trashed: result.movedToTrash,
                  renamed: result.renamed,
                  failed: result.failed,
                }),
                result.failed > 0 ? 10000 : 6000,
              );
              if (result.failed > 0 && result.errors[0]) {
                new Notice(`${tNow("status.prefix")}${result.errors[0]}`, 10000);
              }
            } finally {
              this.display();
            }
          }),
      );

    }  // end of "sync" tab

    if (this.activeTab === "general") {
    // ── Reset ──
    new Setting(containerEl).setName(t("reset.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("reset.button.name"))
      .setDesc(t("reset.button.desc"))
      .addButton((btn) =>
        btn
          .setButtonText(t("reset.button.name"))
          .setWarning()
          .onClick(async () => {
            const confirmed = await this.confirmAction({
              title: "confirm.reset.title",
              body: "confirm.reset.body",
              confirm: "confirm.reset.confirm",
            });
            if (!confirmed) return;
            const {
              accessToken,
              refreshToken,
              clientId,
              clientSecret,
              tokenExpiresAt,
              tmdbApiKey,
              uiLanguage,
            } = this.plugin.settings;
            // Preserve auth + UI language across reset; everything else
            // goes back to its default.
            Object.assign(this.plugin.settings, DEFAULT_SETTINGS, {
              accessToken,
              refreshToken,
              clientId,
              clientSecret,
              tokenExpiresAt,
              tmdbApiKey,
              uiLanguage,
            });
            await this.plugin.saveSettings();
            this.plugin.configureAutoSync();
            this.plugin.configureDailyNotesAutoSync();
            new Notice(t("reset.notice"));
            this.display();
          }),
      );
    }  // end of "general" tab — second half (Reset)
  }
}

/**
 * [1.0.0] Date-range backfill modal (replaces the 0.7.0 N-days
 * confirmation modal). User picks a start + end date with native
 * `<input type="date">` controls, optionally via one of four quick
 * presets (last 7 / last 30 / this month / last month). Modal shows
 * live counts: total days in range + how many of those days already
 * have a Daily Note file on disk. Confirm button disables when the
 * range is invalid (start > end).
 *
 * Safety contract from spec 0006 still holds: past-day mode is
 * add-only on existing markered content, today gets overwrite mode.
 * The same `manualBackfill` function processes either mode per day.
 */
export class BackfillRangeModal extends Modal {
  private settings: TraktrSettings;
  private translate: ReturnType<typeof getTranslator>;
  private onConfirm: (fromDate: string, toDate: string) => Promise<void>;
  // Mutable UI state, rebuilt on every change to keep stats live.
  private fromDate: string;
  private toDate: string;
  private rangeDaysEl: HTMLElement | null = null;
  private existingNotesEl: HTMLElement | null = null;
  private invalidEl: HTMLElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;
  private fromInput: HTMLInputElement | null = null;
  private toInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    settings: TraktrSettings,
    translate: ReturnType<typeof getTranslator>,
    onConfirm: (fromDate: string, toDate: string) => Promise<void>,
  ) {
    super(app);
    this.settings = settings;
    this.translate = translate;
    // Default range: last 7 days (matches the old default).
    this.toDate = localTodayISODate();
    this.fromDate = addDaysISO(this.toDate, -6);
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.translate("daily.backfill.modal.title"));

    // ── Preset row ──
    const presetWrap = contentEl.createDiv({ cls: "trakt-backfill-presets" });
    presetWrap.createEl("span", {
      cls: "trakt-backfill-preset-label",
      text: this.translate("daily.backfill.modal.presetLabel") + ":",
    });
    const today = localTodayISODate();
    const mkPreset = (
      label: string,
      from: string,
      to: string,
    ): void => {
      const btn = presetWrap.createEl("button", {
        cls: "trakt-backfill-preset-btn",
        text: label,
      });
      btn.onclick = () => {
        this.fromDate = from;
        this.toDate = to;
        if (this.fromInput) this.fromInput.value = from;
        if (this.toInput) this.toInput.value = to;
        this.refresh();
      };
    };
    mkPreset(this.translate("daily.backfill.modal.preset.last7"),
      addDaysISO(today, -6), today);
    mkPreset(this.translate("daily.backfill.modal.preset.last30"),
      addDaysISO(today, -29), today);
    const monthBounds = computeThisMonth(today);
    mkPreset(this.translate("daily.backfill.modal.preset.thisMonth"),
      monthBounds.start, monthBounds.end);
    const lastMonth = computeLastMonth(today);
    mkPreset(this.translate("daily.backfill.modal.preset.lastMonth"),
      lastMonth.start, lastMonth.end);

    // ── Date inputs ──
    new Setting(contentEl)
      .setName(this.translate("daily.backfill.modal.startDate"))
      .then((setting) => {
        this.fromInput = setting.controlEl.createEl("input", {
          attr: { type: "date", value: this.fromDate },
        });
        this.fromInput.addEventListener("change", () => {
          this.fromDate = this.fromInput!.value;
          this.refresh();
        });
      });

    new Setting(contentEl)
      .setName(this.translate("daily.backfill.modal.endDate"))
      .then((setting) => {
        this.toInput = setting.controlEl.createEl("input", {
          attr: { type: "date", value: this.toDate },
        });
        this.toInput.addEventListener("change", () => {
          this.toDate = this.toInput!.value;
          this.refresh();
        });
      });

    // ── Live stats ──
    this.rangeDaysEl = contentEl.createEl("p", {
      cls: "trakt-backfill-stat",
    });
    this.existingNotesEl = contentEl.createEl("p", {
      cls: "trakt-backfill-stat",
    });
    this.invalidEl = contentEl.createEl("p", {
      cls: "trakt-backfill-invalid",
    });

    // ── Description body ──
    const body = this.translate("daily.backfill.modal.body");
    for (const para of body.split("\n")) {
      if (para.trim() === "") {
        contentEl.createEl("br");
      } else {
        contentEl.createEl("p", { cls: "trakt-backfill-body", text: para });
      }
    }

    // ── Buttons ──
    const btnContainer = contentEl.createDiv({ cls: "trakt-modal-buttons" });
    const cancelBtn = btnContainer.createEl("button", {
      text: this.translate("daily.backfill.modal.cancel"),
    });
    cancelBtn.onclick = () => this.close();

    this.confirmBtn = btnContainer.createEl("button", {
      text: this.translate("daily.backfill.modal.confirm"),
      cls: "mod-cta",
    });
    this.confirmBtn.onclick = async () => {
      if (this.fromDate > this.toDate) return;
      const from = this.fromDate;
      const to = this.toDate;
      this.close();
      await this.onConfirm(from, to);
    };

    this.refresh();
  }

  /** Recompute live stats whenever a date input or preset changes. */
  private refresh(): void {
    const valid = this.fromDate && this.toDate && this.fromDate <= this.toDate;

    if (!valid) {
      if (this.rangeDaysEl) this.rangeDaysEl.setText("");
      if (this.existingNotesEl) this.existingNotesEl.setText("");
      if (this.invalidEl) {
        this.invalidEl.setText(this.translate("daily.backfill.modal.invalid"));
        this.invalidEl.show();
      }
      if (this.confirmBtn) this.confirmBtn.disabled = true;
      return;
    }

    if (this.invalidEl) {
      this.invalidEl.setText("");
      this.invalidEl.hide();
    }

    const days = daysBetweenISO(this.fromDate, this.toDate) + 1;
    const existing = countExistingDailyNotes(
      this.app,
      this.settings,
      this.fromDate,
      this.toDate,
    );

    if (this.rangeDaysEl) {
      this.rangeDaysEl.setText(
        this.translate("daily.backfill.modal.rangeDays", { days }),
      );
    }
    if (this.existingNotesEl) {
      this.existingNotesEl.setText(
        this.translate("daily.backfill.modal.existingNotes", { count: existing }),
      );
    }
    if (this.confirmBtn) this.confirmBtn.disabled = false;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Count how many Daily Note files in the configured folder exist for
 * dates in [from, to]. Used for the modal's live "Existing Daily Notes
 * in range: M" stat. Synchronous (vault.getAbstractFileByPath is sync)
 * so the count updates with zero lag on every date-input change.
 */
function countExistingDailyNotes(
  app: App,
  settings: TraktrSettings,
  from: string,
  to: string,
): number {
  const moment = (window as unknown as {
    moment: (i: string, f: string) => { format(o: string): string };
  }).moment;
  let count = 0;
  let cursor = from;
  while (cursor <= to) {
    const path = computeDailyNotePath(
      cursor,
      settings.dailyNotesFolder,
      settings.dailyNotesFilenameFormat,
      moment,
    );
    if (app.vault.getAbstractFileByPath(path)) count++;
    cursor = addDaysISO(cursor, 1);
  }
  return count;
}
