/**
 * Document storage (PRD §8.2 — encrypted storage for uploaded documents).
 *
 * Two invariants:
 *   1. Every file is encrypted before it touches disk or object storage.
 *   2. Nothing is written into a statically served directory. Reads go through
 *      an authorised controller that checks access first.
 *
 * The driver is swappable so local development needs no cloud credentials while
 * production uses object storage.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { encryptBuffer, decryptBuffer, sha256 } from '../utils/crypto.js';
import { NotFoundError, ServiceUnavailableError } from '../utils/errors.js';

export interface StoredFile {
  storageKey: string;
  iv: string;
  checksumSha256: string;
  sizeBytes: number;
}

interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

// ── Local driver (development) ─────────────────────────────────────────────

// Vercel's Node runtime has a read-only filesystem everywhere except /tmp —
// writing to env.STORAGE_LOCAL_PATH (a relative path under the deployment
// bundle) throws EROFS on every upload. /tmp is at least writable, but it is
// NOT a real fix: it is wiped between cold starts and is local to whichever
// single instance handled the request, so a read on a different (or
// recycled) instance loses the file. This only stops uploads from crashing
// outright — it does not make document storage reliable. Treat any document
// uploaded in production through this driver as liable to disappear, and
// replace it with the S3 driver below before this app holds real student
// documents long-term.
const LOCAL_STORAGE_ROOT = process.env.VERCEL
  ? path.join(os.tmpdir(), 'waylen-documents')
  : env.STORAGE_LOCAL_PATH;

if (env.isProduction && env.STORAGE_DRIVER === 'local') {
  logger.warn(
    'STORAGE_DRIVER is "local" in production — documents are written to ' +
      (process.env.VERCEL ? '/tmp, which' : env.STORAGE_LOCAL_PATH + ', which') +
      ' does not persist across serverless instances or cold starts. ' +
      'Uploaded documents will intermittently or permanently disappear. ' +
      'This is a stop-gap only — implement the S3 driver in ' +
      'src/services/storage.service.ts before relying on this in production.',
  );
}

const localDriver: StorageDriver = {
  async put(key, data) {
    const target = path.join(LOCAL_STORAGE_ROOT, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { mode: 0o600 });
  },

  async get(key) {
    const target = path.join(LOCAL_STORAGE_ROOT, key);
    try {
      return await fs.readFile(target);
    } catch {
      throw new NotFoundError('That file is no longer available.');
    }
  },

  async delete(key) {
    const target = path.join(LOCAL_STORAGE_ROOT, key);
    await fs.rm(target, { force: true });
  },
};

// ── S3 driver (production) ─────────────────────────────────────────────────

const s3Driver: StorageDriver = {
  async put() {
    throw new ServiceUnavailableError(
      'S3 storage driver is not implemented yet. Install @aws-sdk/client-s3 and complete src/services/storage.service.ts.',
    );
  },
  async get() {
    throw new ServiceUnavailableError('S3 storage driver is not implemented yet.');
  },
  async delete() {
    throw new ServiceUnavailableError('S3 storage driver is not implemented yet.');
  },
};

const driver: StorageDriver = env.STORAGE_DRIVER === 's3' ? s3Driver : localDriver;

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Encrypts and stores a file. The returned `storageKey` is opaque and
 * unguessable, so it carries no information about the student even if leaked.
 */
export const storageService = {
  async store(
    buffer: Buffer,
    options: { studentProfileId: string; originalFilename: string },
  ): Promise<StoredFile> {
    const checksum = sha256(buffer);
    const { data, iv } = encryptBuffer(buffer);

    const extension = path.extname(options.originalFilename).toLowerCase().slice(0, 10);
    // Sharded by student so a directory listing never grows unbounded.
    const key = path.posix.join(
      'documents',
      options.studentProfileId,
      `${randomUUID()}${extension}.enc`,
    );

    await driver.put(key, data);

    logger.info(
      { studentProfileId: options.studentProfileId, sizeBytes: buffer.byteLength },
      'Document stored',
    );

    return { storageKey: key, iv, checksumSha256: checksum, sizeBytes: buffer.byteLength };
  },

  /**
   * Retrieves and decrypts. When `expectedChecksum` is supplied, a mismatch
   * throws rather than returning a corrupted or substituted file.
   */
  async retrieve(storageKey: string, expectedChecksum?: string | null): Promise<Buffer> {
    const encrypted = await driver.get(storageKey);
    const plaintext = decryptBuffer(encrypted);

    if (expectedChecksum && sha256(plaintext) !== expectedChecksum) {
      logger.error({ storageKey }, 'Document checksum mismatch — possible tampering');
      throw new ServiceUnavailableError('That file failed an integrity check and cannot be served.');
    }

    return plaintext;
  },

  async remove(storageKey: string): Promise<void> {
    await driver.delete(storageKey);
    logger.info({ storageKey }, 'Document removed');
  },
};
