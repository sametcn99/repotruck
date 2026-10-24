export const LATEST_STORE_VERSION = 1;

export interface StoreMigration {
  from: number;
  to: number;
  migrate: (store: unknown) => unknown;
}

export const STORE_MIGRATIONS: readonly StoreMigration[] = [];

export interface ValidStoreEnvelope {
  version: number;
  workspaces: unknown[];
}

export type StoreEnvelopeResult =
  | { ok: true; store: ValidStoreEnvelope }
  | { ok: false; reason: string };

export function validateStoreEnvelope(parsed: unknown): StoreEnvelopeResult {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "expected a JSON object" };
  }
  const record = parsed as { version?: unknown; workspaces?: unknown };
  if (record.version === undefined) {
    return { ok: false, reason: "missing version field" };
  }
  if (typeof record.version !== "number" || !Number.isInteger(record.version)) {
    return { ok: false, reason: "version is not an integer" };
  }
  if (!Array.isArray(record.workspaces)) {
    return { ok: false, reason: "workspaces is not an array" };
  }
  return { ok: true, store: { version: record.version, workspaces: record.workspaces } };
}

export class StoreMigrationError extends Error {
  readonly fromVersion: number;
  readonly toVersion: number;

  constructor(fromVersion: number, toVersion: number) {
    super(
      `repotruck.json store version ${fromVersion} has no migration path to ${toVersion} — this repotruck build is too old for it; upgrade repotruck`,
    );
    this.name = "StoreMigrationError";
    this.fromVersion = fromVersion;
    this.toVersion = toVersion;
  }
}

export function applyStoreMigrations(store: ValidStoreEnvelope): ValidStoreEnvelope {
  let current: ValidStoreEnvelope = store;
  while (current.version < LATEST_STORE_VERSION) {
    const step = STORE_MIGRATIONS.find((migration) => migration.from === current.version);
    if (step === undefined) {
      throw new StoreMigrationError(current.version, LATEST_STORE_VERSION);
    }
    const migrated: unknown = step.migrate(current);
    const revalidated = validateStoreEnvelope(migrated);
    if (!revalidated.ok) {
      throw new Error(
        `migration to version ${step.to} produced an invalid store (${revalidated.reason})`,
      );
    }
    current = revalidated.store;
  }
  return current;
}

export class CorruptStoreError extends Error {
  readonly storePath: string;
  readonly backupPath: string;

  constructor(reason: string, storePath: string, backupPath: string) {
    super(
      `repotruck.json is corrupt (${reason}); backed up to ${backupPath} — fix or remove ${storePath} and retry`,
    );
    this.name = "CorruptStoreError";
    this.storePath = storePath;
    this.backupPath = backupPath;
  }
}

export class NewerStoreVersionError extends Error {
  readonly storePath: string;
  readonly backupPath: string;

  constructor(version: number, supported: number, storePath: string, backupPath: string) {
    super(
      `repotruck.json was written by a newer repotruck (version ${version}, supported up to ${supported}); backed up to ${backupPath} — fix or remove ${storePath} and retry`,
    );
    this.name = "NewerStoreVersionError";
    this.storePath = storePath;
    this.backupPath = backupPath;
  }
}
