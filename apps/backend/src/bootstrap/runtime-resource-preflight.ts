import { createHash } from 'crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'fs';
import { resolve } from 'path';
import {
  PREFERENCE_CATALOG_INTEGRITY_MESSAGE,
  PREFERENCE_CATALOG_MISSING_MESSAGE,
} from './startup-diagnostics';

export const PREFERENCE_CATALOG_SHA256 =
  'a86182cd8cace1281e236fd53b8c7df9a5b1be705e2fe3a5cf4e0989ea325e81';
export const PREFERENCE_CATALOG_BYTE_LENGTH = 4273;

type PreferenceCatalogData = Record<string, unknown>;

class PreferenceCatalogMissingError extends Error {}
class PreferenceCatalogIntegrityError extends Error {}

export interface RuntimeResourcePreflightOptions {
  readCatalogBytes?: () => Buffer | Promise<Buffer>;
}

export interface ValidatedPreferenceCatalogSnapshot {
  validate(): void;
  getCatalog(): PreferenceCatalogData;
}

export function readPreferenceCatalogFile(catalogPath: string): Buffer {
  let pathInfo;
  try {
    pathInfo = lstatSync(catalogPath);
  } catch {
    throw new PreferenceCatalogMissingError();
  }

  if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) {
    throw new PreferenceCatalogIntegrityError();
  }

  let descriptor: number;
  try {
    descriptor = openSync(
      catalogPath,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new PreferenceCatalogIntegrityError();
    }
    throw new PreferenceCatalogMissingError();
  }

  let bytes: Buffer | undefined;
  let failure: PreferenceCatalogIntegrityError | undefined;
  try {
    const openedInfo = fstatSync(descriptor);
    if (
      !openedInfo.isFile() ||
      openedInfo.size !== PREFERENCE_CATALOG_BYTE_LENGTH ||
      openedInfo.dev !== pathInfo.dev ||
      openedInfo.ino !== pathInfo.ino
    ) {
      throw new PreferenceCatalogIntegrityError();
    }

    bytes = Buffer.alloc(PREFERENCE_CATALOG_BYTE_LENGTH);
    let offset = 0;
    while (offset < bytes.length) {
      const readCount = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (readCount === 0) throw new PreferenceCatalogIntegrityError();
      offset += readCount;
    }

    if (readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length) !== 0) {
      throw new PreferenceCatalogIntegrityError();
    }

    const finalInfo = fstatSync(descriptor);
    if (!finalInfo.isFile() || finalInfo.size !== bytes.length) {
      throw new PreferenceCatalogIntegrityError();
    }
  } catch {
    failure = new PreferenceCatalogIntegrityError();
  }

  try {
    closeSync(descriptor);
  } catch {
    failure = new PreferenceCatalogIntegrityError();
  }

  if (failure || !bytes) throw new PreferenceCatalogIntegrityError();
  return bytes;
}

function readPackagedCatalogBytes(): Buffer {
  return readPreferenceCatalogFile(
    resolve(__dirname, '..', 'config', 'preferences.catalog.json'),
  );
}

function validatePreferenceCatalogBytes(bytes: Buffer): PreferenceCatalogData {
  if (bytes.length !== PREFERENCE_CATALOG_BYTE_LENGTH) {
    throw new PreferenceCatalogIntegrityError();
  }

  let catalog: unknown;
  try {
    catalog = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new PreferenceCatalogIntegrityError();
  }

  const digest = createHash('sha256').update(bytes).digest('hex');
  if (
    digest !== PREFERENCE_CATALOG_SHA256 ||
    typeof catalog !== 'object' ||
    catalog === null ||
    Array.isArray(catalog)
  ) {
    throw new PreferenceCatalogIntegrityError();
  }
  return catalog as PreferenceCatalogData;
}

export function createValidatedPreferenceCatalogSnapshot(
  readCatalogBytes: () => Buffer,
): ValidatedPreferenceCatalogSnapshot {
  let catalog: PreferenceCatalogData | undefined;
  const load = (): PreferenceCatalogData => {
    if (catalog) return catalog;

    let bytes: Buffer;
    try {
      bytes = readCatalogBytes();
    } catch (error) {
      if (error instanceof PreferenceCatalogIntegrityError) throw error;
      throw new PreferenceCatalogMissingError();
    }
    catalog = validatePreferenceCatalogBytes(bytes);
    return catalog;
  };

  return {
    validate: () => {
      load();
    },
    getCatalog: load,
  };
}

const packagedPreferenceCatalog = createValidatedPreferenceCatalogSnapshot(
  readPackagedCatalogBytes,
);

function publicResourceError(error: unknown): Error {
  return new Error(
    error instanceof PreferenceCatalogIntegrityError
      ? PREFERENCE_CATALOG_INTEGRITY_MESSAGE
      : PREFERENCE_CATALOG_MISSING_MESSAGE,
  );
}

export function getValidatedPreferenceCatalog(): PreferenceCatalogData {
  try {
    return packagedPreferenceCatalog.getCatalog();
  } catch (error) {
    throw publicResourceError(error);
  }
}

export async function validateHostedRuntimeResources({
  readCatalogBytes,
}: RuntimeResourcePreflightOptions = {}): Promise<void> {
  if (!readCatalogBytes) {
    try {
      packagedPreferenceCatalog.validate();
      return;
    } catch (error) {
      throw publicResourceError(error);
    }
  }

  let bytes: Buffer;
  try {
    bytes = await readCatalogBytes();
  } catch (error) {
    throw publicResourceError(error);
  }

  try {
    validatePreferenceCatalogBytes(bytes);
  } catch (error) {
    throw publicResourceError(error);
  }
}
