import { App, TFile, TFolder, normalizePath } from "obsidian";
import { getTranslator, type StringKey } from "./strings";
import type { TraktrSettings } from "./settings";

export type BaseFileKind =
  | "movies"
  | "shows"
  | "watchlist"
  | "watched"
  | "ratings"
  | "library";

export const BASE_FILE_KINDS: ReadonlyArray<BaseFileKind> = [
  "library",
  "movies",
  "shows",
  "watchlist",
  "watched",
  "ratings",
];

export type BaseFieldGroup =
  | "core"
  | "ratings"
  | "activity"
  | "progress"
  | "release"
  | "links"
  | "sync";

export const BASE_FIELD_GROUPS: ReadonlyArray<BaseFieldGroup> = [
  "core",
  "ratings",
  "activity",
  "progress",
  "release",
  "links",
  "sync",
];

export type BaseDisplayField =
  | "type"
  | "year"
  | "genres"
  | "overview"
  | "runtime"
  | "certification"
  | "country"
  | "language"
  | "tags"
  | "tag_notes"
  | "community_rating"
  | "votes"
  | "personal_rating"
  | "library_status"
  | "watched"
  | "watchlist"
  | "favorite"
  | "plays"
  | "last_watched_at"
  | "watchlist_added_at"
  | "favorited_at"
  | "rated_at"
  | "episode_progress"
  | "episodes_watched"
  | "aired_episodes"
  | "show_status"
  | "network"
  | "first_aired"
  | "released"
  | "tagline"
  | "trakt_id"
  | "slug"
  | "imdb_id"
  | "tmdb_id"
  | "tvdb_id"
  | "trakt_url"
  | "imdb_url"
  | "synced_at"
  | "community_stats_synced_at";

export type BaseDisplaySettings = Record<
  BaseFileKind,
  BaseDisplayField[]
>;

type BasePropertyKey =
  | "type"
  | "year"
  | "genres"
  | "overview"
  | "runtime"
  | "certification"
  | "country"
  | "language"
  | "tag_notes"
  | "rating"
  | "votes"
  | "my_rating"
  | "watched"
  | "watchlist"
  | "favorite"
  | "plays"
  | "last_watched_at"
  | "watchlist_added_at"
  | "favorited_at"
  | "rated_at"
  | "episodes_watched"
  | "aired_episodes"
  | "status"
  | "network"
  | "first_aired"
  | "released"
  | "tagline"
  | "id"
  | "slug"
  | "imdb_id"
  | "tmdb_id"
  | "tvdb_id"
  | "url"
  | "imdb_url"
  | "synced_at"
  | "community_stats_synced_at"
  | "poster_url";

export const BASE_PROPERTY_KEYS: ReadonlyArray<BasePropertyKey> = [
  "type",
  "year",
  "genres",
  "overview",
  "runtime",
  "certification",
  "country",
  "language",
  "tag_notes",
  "rating",
  "votes",
  "my_rating",
  "watched",
  "watchlist",
  "favorite",
  "plays",
  "last_watched_at",
  "watchlist_added_at",
  "favorited_at",
  "rated_at",
  "episodes_watched",
  "aired_episodes",
  "status",
  "network",
  "first_aired",
  "released",
  "tagline",
  "id",
  "slug",
  "imdb_id",
  "tmdb_id",
  "tvdb_id",
  "url",
  "imdb_url",
  "synced_at",
  "community_stats_synced_at",
  "poster_url",
];

const BASE_PROPERTY_KEY_SET = new Set<BasePropertyKey>(BASE_PROPERTY_KEYS);

type FormulaKey =
  | "poster"
  | "community_rating"
  | "personal_rating"
  | "library_status"
  | "episode_progress";

type ViewOrderItem =
  | "file.name"
  | "note.tags"
  | BasePropertyKey
  | `formula.${FormulaKey}`;

export interface BaseDisplayFieldDefinition {
  id: BaseDisplayField;
  group: BaseFieldGroup;
  labelKey: StringKey;
  orderItem: ViewOrderItem;
}

export const BASE_DISPLAY_FIELD_DEFINITIONS: ReadonlyArray<BaseDisplayFieldDefinition> =
  [
    { id: "type", group: "core", labelKey: "bases.field.type", orderItem: "type" },
    { id: "year", group: "core", labelKey: "bases.field.year", orderItem: "year" },
    { id: "genres", group: "core", labelKey: "bases.field.genres", orderItem: "genres" },
    {
      id: "overview",
      group: "core",
      labelKey: "bases.field.overview",
      orderItem: "overview",
    },
    {
      id: "runtime",
      group: "core",
      labelKey: "bases.field.runtime",
      orderItem: "runtime",
    },
    {
      id: "certification",
      group: "core",
      labelKey: "bases.field.certification",
      orderItem: "certification",
    },
    {
      id: "country",
      group: "core",
      labelKey: "bases.field.country",
      orderItem: "country",
    },
    {
      id: "language",
      group: "core",
      labelKey: "bases.field.language",
      orderItem: "language",
    },
    { id: "tags", group: "core", labelKey: "bases.field.tags", orderItem: "note.tags" },
    {
      id: "tag_notes",
      group: "core",
      labelKey: "bases.field.tagNotes",
      orderItem: "tag_notes",
    },
    {
      id: "community_rating",
      group: "ratings",
      labelKey: "bases.field.communityRating",
      orderItem: "formula.community_rating",
    },
    {
      id: "votes",
      group: "ratings",
      labelKey: "bases.field.votes",
      orderItem: "votes",
    },
    {
      id: "personal_rating",
      group: "ratings",
      labelKey: "bases.field.personalRating",
      orderItem: "formula.personal_rating",
    },
    {
      id: "library_status",
      group: "activity",
      labelKey: "bases.field.libraryStatus",
      orderItem: "formula.library_status",
    },
    {
      id: "watched",
      group: "activity",
      labelKey: "bases.field.watched",
      orderItem: "watched",
    },
    {
      id: "watchlist",
      group: "activity",
      labelKey: "bases.field.watchlist",
      orderItem: "watchlist",
    },
    {
      id: "favorite",
      group: "activity",
      labelKey: "bases.field.favorite",
      orderItem: "favorite",
    },
    {
      id: "plays",
      group: "activity",
      labelKey: "bases.field.plays",
      orderItem: "plays",
    },
    {
      id: "last_watched_at",
      group: "activity",
      labelKey: "bases.field.lastWatched",
      orderItem: "last_watched_at",
    },
    {
      id: "watchlist_added_at",
      group: "activity",
      labelKey: "bases.field.watchlistAdded",
      orderItem: "watchlist_added_at",
    },
    {
      id: "favorited_at",
      group: "activity",
      labelKey: "bases.field.favoritedAt",
      orderItem: "favorited_at",
    },
    {
      id: "rated_at",
      group: "activity",
      labelKey: "bases.field.ratedAt",
      orderItem: "rated_at",
    },
    {
      id: "episode_progress",
      group: "progress",
      labelKey: "bases.field.episodeProgress",
      orderItem: "formula.episode_progress",
    },
    {
      id: "episodes_watched",
      group: "progress",
      labelKey: "bases.field.episodesWatched",
      orderItem: "episodes_watched",
    },
    {
      id: "aired_episodes",
      group: "progress",
      labelKey: "bases.field.airedEpisodes",
      orderItem: "aired_episodes",
    },
    {
      id: "show_status",
      group: "progress",
      labelKey: "bases.field.showStatus",
      orderItem: "status",
    },
    {
      id: "network",
      group: "progress",
      labelKey: "bases.field.network",
      orderItem: "network",
    },
    {
      id: "first_aired",
      group: "progress",
      labelKey: "bases.field.firstAired",
      orderItem: "first_aired",
    },
    {
      id: "released",
      group: "release",
      labelKey: "bases.field.released",
      orderItem: "released",
    },
    {
      id: "tagline",
      group: "release",
      labelKey: "bases.field.tagline",
      orderItem: "tagline",
    },
    {
      id: "trakt_id",
      group: "links",
      labelKey: "bases.field.traktId",
      orderItem: "id",
    },
    {
      id: "slug",
      group: "links",
      labelKey: "bases.field.slug",
      orderItem: "slug",
    },
    {
      id: "imdb_id",
      group: "links",
      labelKey: "bases.field.imdbId",
      orderItem: "imdb_id",
    },
    {
      id: "tmdb_id",
      group: "links",
      labelKey: "bases.field.tmdbId",
      orderItem: "tmdb_id",
    },
    {
      id: "tvdb_id",
      group: "links",
      labelKey: "bases.field.tvdbId",
      orderItem: "tvdb_id",
    },
    {
      id: "trakt_url",
      group: "links",
      labelKey: "bases.field.traktUrl",
      orderItem: "url",
    },
    {
      id: "imdb_url",
      group: "links",
      labelKey: "bases.field.imdbUrl",
      orderItem: "imdb_url",
    },
    {
      id: "synced_at",
      group: "sync",
      labelKey: "bases.field.syncedAt",
      orderItem: "synced_at",
    },
    {
      id: "community_stats_synced_at",
      group: "sync",
      labelKey: "bases.field.communityStatsSyncedAt",
      orderItem: "community_stats_synced_at",
    },
  ];

export const DEFAULT_BASE_DISPLAY_FIELDS: Readonly<
  BaseDisplaySettings
> = {
  library: [
    "type",
    "year",
    "library_status",
    "episode_progress",
    "community_rating",
    "personal_rating",
    "genres",
  ],
  movies: [
    "year",
    "community_rating",
    "personal_rating",
    "genres",
    "library_status",
  ],
  shows: [
    "show_status",
    "episode_progress",
    "community_rating",
    "personal_rating",
    "genres",
    "library_status",
  ],
  watchlist: [
    "type",
    "year",
    "community_rating",
    "genres",
    "watchlist_added_at",
  ],
  watched: [
    "type",
    "year",
    "episode_progress",
    "personal_rating",
    "community_rating",
    "last_watched_at",
  ],
  ratings: [
    "type",
    "year",
    "personal_rating",
    "community_rating",
    "genres",
    "rated_at",
  ],
};

export interface BaseFileDefinition {
  kind: BaseFileKind;
  filename: string;
  content: string;
}

export type BaseFileWriteStatus = "created" | "updated" | "skipped";

export interface BaseFileWriteResult {
  path: string;
  status: BaseFileWriteStatus;
}

export type BaseFileErrorCode = "folder_path_is_file" | "target_is_not_file";

export class BaseFileError extends Error {
  code: BaseFileErrorCode;
  path: string;

  constructor(code: BaseFileErrorCode, path: string) {
    super(code);
    this.name = "BaseFileError";
    this.code = code;
    this.path = path;
  }
}

interface BaseSort {
  key: BasePropertyKey | "file.name";
  direction: "ASC" | "DESC";
}

const BASE_SORTS: Readonly<Record<BaseFileKind, ReadonlyArray<BaseSort>>> = {
  movies: [
    { key: "rating", direction: "DESC" },
    { key: "year", direction: "DESC" },
    { key: "file.name", direction: "ASC" },
  ],
  shows: [
    { key: "rating", direction: "DESC" },
    { key: "year", direction: "DESC" },
    { key: "file.name", direction: "ASC" },
  ],
  watchlist: [
    { key: "watchlist_added_at", direction: "DESC" },
    { key: "rating", direction: "DESC" },
    { key: "file.name", direction: "ASC" },
  ],
  watched: [
    { key: "last_watched_at", direction: "DESC" },
    { key: "rating", direction: "DESC" },
    { key: "file.name", direction: "ASC" },
  ],
  ratings: [
    { key: "my_rating", direction: "DESC" },
    { key: "rated_at", direction: "DESC" },
    { key: "file.name", direction: "ASC" },
  ],
  library: [
    { key: "year", direction: "DESC" },
    { key: "rating", direction: "DESC" },
    { key: "file.name", direction: "ASC" },
  ],
};

const BASE_FILENAME: Readonly<Record<BaseFileKind, string>> = {
  movies: "Movies.base",
  shows: "Shows.base",
  watchlist: "Watchlist.base",
  watched: "Watched.base",
  ratings: "Ratings.base",
  library: "Trakt Library.base",
};

const BASE_NAME_KEY: Readonly<Record<BaseFileKind, StringKey>> = {
  movies: "bases.movies.name",
  shows: "bases.shows.name",
  watchlist: "bases.watchlist.name",
  watched: "bases.watched.name",
  ratings: "bases.ratings.name",
  library: "bases.library.name",
};

const FIELD_IDS = new Set<BaseDisplayField>(
  BASE_DISPLAY_FIELD_DEFINITIONS.map((field) => field.id),
);

export function createDefaultBaseDisplayFields(): BaseDisplaySettings {
  return {
    library: [...DEFAULT_BASE_DISPLAY_FIELDS.library],
    movies: [...DEFAULT_BASE_DISPLAY_FIELDS.movies],
    shows: [...DEFAULT_BASE_DISPLAY_FIELDS.shows],
    watchlist: [...DEFAULT_BASE_DISPLAY_FIELDS.watchlist],
    watched: [...DEFAULT_BASE_DISPLAY_FIELDS.watched],
    ratings: [...DEFAULT_BASE_DISPLAY_FIELDS.ratings],
  };
}

export function getBaseDisplayFields(
  settings: Pick<TraktrSettings, "basesDisplayFields">,
  kind: BaseFileKind,
): BaseDisplayField[] {
  const configured = settings.basesDisplayFields?.[kind];
  if (!Array.isArray(configured)) {
    return [...DEFAULT_BASE_DISPLAY_FIELDS[kind]];
  }
  const selected = new Set(
    configured.filter((field) => FIELD_IDS.has(field)),
  );
  return BASE_DISPLAY_FIELD_DEFINITIONS.filter((field) =>
    selected.has(field.id),
  ).map((field) => field.id);
}

export function getResolvedBaseDisplaySettings(
  settings: Pick<TraktrSettings, "basesDisplayFields">,
): BaseDisplaySettings {
  return {
    library: getBaseDisplayFields(settings, "library"),
    movies: getBaseDisplayFields(settings, "movies"),
    shows: getBaseDisplayFields(settings, "shows"),
    watchlist: getBaseDisplayFields(settings, "watchlist"),
    watched: getBaseDisplayFields(settings, "watched"),
    ratings: getBaseDisplayFields(settings, "ratings"),
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function normalizedFolder(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function mediaFolderFilter(settings: TraktrSettings): string {
  const folder = normalizedFolder(settings.folder);
  return folder === ""
    ? 'file.folder == ""'
    : `file.inFolder(${yamlString(folder)})`;
}

function propertyReference(
  settings: TraktrSettings,
  key: BasePropertyKey,
): string {
  return `note[${yamlString(buildBasePropertyName(settings.propertyPrefix, key))}]`;
}

function propertyExistsFilter(
  settings: TraktrSettings,
  key: BasePropertyKey,
): string {
  return `file.hasProperty(${yamlString(
    buildBasePropertyName(settings.propertyPrefix, key),
  )})`;
}

function propertyPath(settings: TraktrSettings, key: BasePropertyKey): string {
  return `note.${buildBasePropertyName(settings.propertyPrefix, key)}`;
}

function orderItem(settings: TraktrSettings, item: ViewOrderItem): string {
  if (item === "file.name" || item.startsWith("formula.")) return item;
  if (item === "note.tags") return "tags";
  return buildBasePropertyName(settings.propertyPrefix, item);
}

function sortProperty(
  settings: TraktrSettings,
  key: BaseSort["key"],
): string {
  return key === "file.name"
    ? key
    : buildBasePropertyName(settings.propertyPrefix, key);
}

function fieldDefinition(id: BaseDisplayField): BaseDisplayFieldDefinition {
  return BASE_DISPLAY_FIELD_DEFINITIONS.find((field) => field.id === id)!;
}

function isBasePropertyKey(value: ViewOrderItem): value is BasePropertyKey {
  return BASE_PROPERTY_KEY_SET.has(value as BasePropertyKey);
}

function selectedOrderItems(
  settings: TraktrSettings,
  kind: BaseFileKind,
): ViewOrderItem[] {
  return getBaseDisplayFields(settings, kind).map(
    (id) => fieldDefinition(id).orderItem,
  );
}

function buildFormulaSection(settings: TraktrSettings): string[] {
  const t = getTranslator();
  const poster = propertyReference(settings, "poster_url");
  const communityRating = propertyReference(settings, "rating");
  const personalRating = propertyReference(settings, "my_rating");
  const watched = propertyReference(settings, "watched");
  const watchlist = propertyReference(settings, "watchlist");
  const episodesWatched = propertyReference(settings, "episodes_watched");
  const airedEpisodes = propertyReference(settings, "aired_episodes");
  const type = propertyReference(settings, "type");

  return [
    "formulas:",
    `  poster: ${yamlString(`image(${poster})`)}`,
    `  community_rating: ${yamlString(
      `if(${communityRating} == null, "", ["★", ${communityRating}.toFixed(1)].join(" "))`,
    )}`,
    `  personal_rating: ${yamlString(
      `if(${personalRating} == null, "", ["★", ${personalRating}.toString(), "/ 10"].join(" "))`,
    )}`,
    `  library_status: ${yamlString(
      `if(${watched} == true, ${yamlString(t("bases.value.watched"))}, if(${watchlist} == true, ${yamlString(t("bases.value.watchlist"))}, ""))`,
    )}`,
    `  episode_progress: ${yamlString(
      `if(${type} != "show" || ${episodesWatched} == null || ${airedEpisodes} == null || ${airedEpisodes} <= 0, "", [${episodesWatched}.toString(), " / ", ${airedEpisodes}.toString(), " · ", ((${episodesWatched} / ${airedEpisodes}) * 100).round().toString(), "%"].join(""))`,
    )}`,
  ];
}

function buildPropertiesSection(settings: TraktrSettings): string[] {
  const t = getTranslator();
  const lines = [
    "properties:",
    "  file.name:",
    `    displayName: ${yamlString(t("bases.field.title"))}`,
    "  note.tags:",
    `    displayName: ${yamlString(t("bases.field.tags"))}`,
  ];

  for (const field of BASE_DISPLAY_FIELD_DEFINITIONS) {
    if (!isBasePropertyKey(field.orderItem)) continue;
    lines.push(`  ${yamlString(propertyPath(settings, field.orderItem))}:`);
    lines.push(`    displayName: ${yamlString(t(field.labelKey))}`);
  }

  lines.push(
    `  ${yamlString(propertyPath(settings, "poster_url"))}:`,
    `    displayName: ${yamlString(t("bases.field.posterUrl"))}`,
    "  formula.poster:",
    `    displayName: ${yamlString(t("bases.field.poster"))}`,
  );

  for (const field of BASE_DISPLAY_FIELD_DEFINITIONS) {
    if (!field.orderItem.startsWith("formula.")) continue;
    lines.push(`  ${field.orderItem}:`);
    lines.push(`    displayName: ${yamlString(t(field.labelKey))}`);
  }
  return lines;
}

function buildSortLines(
  settings: TraktrSettings,
  sort: ReadonlyArray<BaseSort>,
): string[] {
  const lines = ["    sort:"];
  for (const entry of sort) {
    lines.push(
      `      - property: ${yamlString(sortProperty(settings, entry.key))}`,
    );
    lines.push(`        direction: ${entry.direction}`);
  }
  return lines;
}

function buildBaseFilters(
  settings: TraktrSettings,
  kind: BaseFileKind,
): string[] {
  if (kind === "movies") {
    return [`${propertyReference(settings, "type")} == "movie"`];
  }
  if (kind === "shows") {
    return [`${propertyReference(settings, "type")} == "show"`];
  }
  if (kind === "watchlist") {
    return [`${propertyReference(settings, "watchlist")} == true`];
  }
  if (kind === "watched") {
    return [`${propertyReference(settings, "watched")} == true`];
  }
  if (kind === "ratings") {
    return [
      propertyExistsFilter(settings, "my_rating"),
      `${propertyReference(settings, "my_rating")} > 0`,
    ];
  }
  return [];
}

function buildBase(settings: TraktrSettings, kind: BaseFileKind): string {
  const t = getTranslator();
  const filters = buildBaseFilters(settings, kind);
  const fields = selectedOrderItems(settings, kind);
  const name = t(BASE_NAME_KEY[kind]);
  const lines: string[] = [
    "filters:",
    "  and:",
    `    - ${yamlString(mediaFolderFilter(settings))}`,
    `    - ${yamlString(propertyExistsFilter(settings, "type"))}`,
  ];

  for (const filter of filters) {
    lines.push(`    - ${yamlString(filter)}`);
  }
  lines.push(...buildFormulaSection(settings));
  lines.push(...buildPropertiesSection(settings));

  lines.push(
    "views:",
    "  - type: cards",
    `    name: ${yamlString(`${name} — ${t("bases.view.posters")}`)}`,
    "    order:",
    '      - "file.name"',
  );
  for (const field of fields) {
    lines.push(`      - ${yamlString(orderItem(settings, field))}`);
  }
  lines.push(
    ...buildSortLines(settings, BASE_SORTS[kind]),
    "    image: formula.poster",
    "    imageFit: cover",
    "    imageAspectRatio: 1.5",
    "    cardSize: 210",
    "  - type: table",
    `    name: ${yamlString(`${name} — ${t("bases.view.details")}`)}`,
    "    order:",
    '      - "formula.poster"',
    '      - "file.name"',
  );
  for (const field of fields) {
    lines.push(`      - ${yamlString(orderItem(settings, field))}`);
  }
  lines.push(
    ...buildSortLines(settings, BASE_SORTS[kind]),
    "    columnSize:",
    "      formula.poster: 72",
    "      file.name: 280",
    `      ${yamlString(propertyPath(settings, "genres"))}: 200`,
    "    rowHeight: medium",
  );

  return `${lines.join("\n")}\n`;
}

export function buildBasePropertyName(prefix: string, key: string): string {
  return `${prefix}${key}`;
}

export function getBaseFileDefinitions(
  settings: TraktrSettings,
): BaseFileDefinition[] {
  const kinds: BaseFileKind[] = [
    "movies",
    "shows",
    "watchlist",
    "watched",
    "ratings",
    "library",
  ];
  return kinds.map((kind) => ({
    kind,
    filename: BASE_FILENAME[kind],
    content: buildBase(settings, kind),
  }));
}

export async function ensureBasesFolder(
  app: App,
  folder: string,
): Promise<string> {
  const normalized = normalizedFolder(normalizePath(folder));
  if (normalized === "") return "";

  const segments = normalized.split("/");
  let current = "";
  for (const segment of segments) {
    current = current === "" ? segment : `${current}/${segment}`;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;
    if (existing) {
      throw new BaseFileError("folder_path_is_file", current);
    }
    await app.vault.createFolder(current);
  }
  return normalized;
}

export async function writeBaseFile(
  app: App,
  folder: string,
  definition: BaseFileDefinition,
  confirmOverwrite: (path: string) => Promise<boolean>,
): Promise<BaseFileWriteResult> {
  const folderPath = await ensureBasesFolder(app, folder);
  const path = normalizePath(
    folderPath === ""
      ? definition.filename
      : `${folderPath}/${definition.filename}`,
  );
  const existing = app.vault.getAbstractFileByPath(path);

  if (existing) {
    if (!(existing instanceof TFile)) {
      throw new BaseFileError("target_is_not_file", path);
    }
    if (!(await confirmOverwrite(path))) {
      return { path, status: "skipped" };
    }
    await app.vault.modify(existing, definition.content);
    return { path, status: "updated" };
  }

  await app.vault.create(path, definition.content);
  return { path, status: "created" };
}
