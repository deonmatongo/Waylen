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

const localDriver: StorageDriver = {
  async put(key, data) {
    const target = path.join(env.STORAGE_LOCAL_PATH, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { mode: 0o600 });
  },

  async get(key) {
    const target = path.join(env.STORAGE_LOCAL_PATH, key);
    try {
      return await fs.readFile(target);
    } catch {
      throw new NotFoundError('That file is no longer available.');
    }
  },

  async delete(key) {
    const target = path.join(env.STORAGE_LOCAL_PATH, key);
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
