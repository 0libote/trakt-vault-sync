import type { App } from "obsidian";
import { EMPTY_HISTORY_STATE, type HistoryState, type TmdbCache } from "./types";

export const RUNTIME_STORAGE_SCHEMA_VERSION = 1 as const;
const RUNTIME_DB_NAME = "sync-trakt-runtime";
const RUNTIME_STORE_NAME = "runtime";
export const RUNTIME_STORAGE_KEY_PREFIX = "sync-trakt:runtime:v1";

export interface RuntimeStoragePayload {
  schemaVersion: typeof RUNTIME_STORAGE_SCHEMA_VERSION;
  tmdbCache: TmdbCache;
  historyState: HistoryState;
}

type RuntimeCarrier = {
  tmdbCache?: TmdbCache;
  historyState?: Partial<HistoryState>;
};

function vaultName(app: App): string {
  const maybeVault = app.vault as unknown as { getName?: () => string };
  const name = maybeVault.getName?.() || "default-vault";
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function runtimeStorageKey(app: App): string {
  return `${RUNTIME_STORAGE_KEY_PREFIX}:${vaultName(app)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isRuntimeStoragePayload(
  value: unknown,
): value is RuntimeStoragePayload {
  if (!isObject(value)) return false;
  return (
    value.schemaVersion === RUNTIME_STORAGE_SCHEMA_VERSION &&
    isObject(value.tmdbCache) &&
    isObject(value.historyState)
  );
}

export function syncedPayloadContainsRuntimeData(
  synced: RuntimeCarrier | null | undefined,
): boolean {
  if (!synced) return false;
  const tmdbEntries = Object.keys(synced.tmdbCache ?? {}).length;
  const history = synced.historyState;
  if (!history) return tmdbEntries > 0;
  return (
    tmdbEntries > 0 ||
    Object.keys(history.byMovie ?? {}).length > 0 ||
    Object.keys(history.byShow ?? {}).length > 0 ||
    (history.knownEventIds ?? []).length > 0 ||
    !!history.lastIncrementalSyncAt ||
    !!history.lastFullRefreshAt
  );
}

export function buildSlimSyncedHistoryState(state: HistoryState): HistoryState {
  return {
    ...EMPTY_HISTORY_STATE,
    lastDailyNoteSyncedAt: state.lastDailyNoteSyncedAt || "",
    lastAuthoritativeFullRefreshAt: state.lastAuthoritativeFullRefreshAt,
    lastReleaseNoticeVersion: state.lastReleaseNoticeVersion,
  };
}

export function mergeSyncedHistoryFields(
  runtimeHistory: Partial<HistoryState>,
  syncedHistory?: Partial<HistoryState>,
): HistoryState {
  return {
    ...EMPTY_HISTORY_STATE,
    ...runtimeHistory,
    lastDailyNoteSyncedAt:
      syncedHistory?.lastDailyNoteSyncedAt ??
      runtimeHistory.lastDailyNoteSyncedAt ??
      "",
    lastAuthoritativeFullRefreshAt:
      syncedHistory?.lastAuthoritativeFullRefreshAt ??
      runtimeHistory.lastAuthoritativeFullRefreshAt,
    lastReleaseNoticeVersion:
      syncedHistory?.lastReleaseNoticeVersion ??
      runtimeHistory.lastReleaseNoticeVersion,
  };
}

function idbError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function getIndexedDb(): IDBFactory | undefined {
  if (typeof activeWindow !== "undefined") {
    return activeWindow.indexedDB;
  }
  if (typeof window !== "undefined") {
    return window.indexedDB;
  }
  return undefined;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const indexedDb = getIndexedDb();
    if (!indexedDb) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDb.open(RUNTIME_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RUNTIME_STORE_NAME)) {
        request.result.createObjectStore(RUNTIME_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(idbError(request.error, "IndexedDB open failed"));
  });
}

async function idbRead(key: string): Promise<unknown> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(RUNTIME_STORE_NAME, "readonly")
        .objectStore(RUNTIME_STORE_NAME)
        .get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () =>
        reject(idbError(request.error, "IndexedDB read failed"));
    });
  } finally {
    db.close();
  }
}

async function idbWrite(
  key: string,
  payload: RuntimeStoragePayload,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RUNTIME_STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(idbError(tx.error, "IndexedDB write failed"));
      tx.onabort = () => reject(idbError(tx.error, "IndexedDB write aborted"));
      tx.objectStore(RUNTIME_STORE_NAME).put(payload, key);
    });
  } finally {
    db.close();
  }
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RUNTIME_STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(idbError(tx.error, "IndexedDB delete failed"));
      tx.onabort = () => reject(idbError(tx.error, "IndexedDB delete aborted"));
      tx.objectStore(RUNTIME_STORE_NAME).delete(key);
    });
  } finally {
    db.close();
  }
}

export class RuntimeStore {
  constructor(
    private app: App,
    private key = runtimeStorageKey(app),
  ) {}

  async load(): Promise<RuntimeStoragePayload | null> {
    if (getIndexedDb()) {
      try {
        const value = await idbRead(this.key);
        if (isRuntimeStoragePayload(value)) {
          return value;
        }
      } catch (error) {
        console.warn("[Traktr] Failed to load runtime cache from IndexedDB:", error);
      }
    }
    const localValue = this.app.loadLocalStorage(this.key) as unknown;
    if (!isRuntimeStoragePayload(localValue)) return null;
    return localValue;
  }

  async save(payload: RuntimeStoragePayload): Promise<void> {
    if (getIndexedDb()) {
      try {
        await idbWrite(this.key, payload);
        return;
      } catch (error) {
        console.warn("[Traktr] Failed to save runtime cache to IndexedDB; falling back to localStorage:", error);
      }
    }
    this.app.saveLocalStorage(this.key, payload);
  }

  async clear(): Promise<void> {
    if (getIndexedDb()) {
      try {
        await idbDelete(this.key);
      } catch (error) {
        console.warn("[Traktr] Failed to clear runtime cache from IndexedDB:", error);
      }
    }
    this.app.saveLocalStorage(this.key, null);
  }
}
