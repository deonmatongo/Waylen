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
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
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
// use STORAGE_DRIVER=s3 before this app holds real student documents.
const LOCAL_STORAGE_ROOT = process.env.VERCEL
  ? path.join(os.tmpdir(), 'waylen-documents')
  : env.STORAGE_LOCAL_PATH;

if (env.isProduction && env.STORAGE_DRIVER === 'local') {
  logger.warn(
    'STORAGE_DRIVER is "local" in production — documents are written to ' +
      (process.env.VERCEL ? '/tmp, which' : env.STORAGE_LOCAL_PATH + ', which') +
      ' does not persist across serverless instances or cold starts. ' +
      'Uploaded documents will intermittently or permanently disappear. ' +
      'Set STORAGE_DRIVER=s3 before relying on this in production.',
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

export interface S3DriverConfig {
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

function isNoSuchKey(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.Code === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/**
 * Works with AWS S3 and S3-compatible stores (R2, Supabase Storage) when an
 * endpoint is supplied. Objects are the already-encrypted blobs; SSE is
 * applied on top as defence in depth. The client is created lazily so the
 * local driver never needs S3 configuration.
 */
export function createS3Driver(config: S3DriverConfig): StorageDriver {
  let client: S3Client | undefined;

  const getClient = (): { s3: S3Client; bucket: string } => {
    if (!config.bucket) {
      throw new ServiceUnavailableError('S3 storage is not configured (S3_BUCKET missing).');
    }
    if (!client) {
      const endpoint = config.endpoint || undefined;
      client = new S3Client({
        region: config.region || 'auto',
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
        ...(config.accessKeyId && config.secretAccessKey
          ? {
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              },
            }
          : {}),
      });
    }
    return { s3: client, bucket: config.bucket };
  };

  return {
    async put(key, data) {
      const { s3, bucket } = getClient();
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: data,
          ContentType: 'application/octet-stream',
          ServerSideEncryption: 'AES256',
        }),
      );
    },

    async get(key) {
      const { s3, bucket } = getClient();
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!res.Body) throw new NotFoundError('That file is no longer available.');
        return Buffer.from(await res.Body.transformToByteArray());
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        if (isNoSuchKey(err)) throw new NotFoundError('That file is no longer available.');
        logger.error({ err, storageKey: key }, 'S3 get failed');
        throw new ServiceUnavailableError('File storage is temporarily unavailable.');
      }
    },

    async delete(key) {
      const { s3, bucket } = getClient();
      // S3 DeleteObject is idempotent: a missing key is not an error.
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

const s3Driver = createS3Driver({
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});

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
