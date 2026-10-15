import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

process.env.APP_URL ??= 'http://localhost:3000';
process.env.DOCUMENT_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');

const { createS3Driver } = await import('../../src/services/storage.service.js');

const s3Mock = mockClient(S3Client);
const config = {
  bucket: 'test-bucket',
  region: 'us-east-1',
  accessKeyId: 'test-key-id',
  secretAccessKey: 'test-secret',
};

describe('S3 storage driver', () => {
  beforeEach(() => s3Mock.reset());

  it('puts the blob with AES256 SSE', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    await createS3Driver(config).put('documents/a/b.enc', Buffer.from('xyz'));
    const input = s3Mock.commandCalls(PutObjectCommand)[0]!.args[0].input;
    expect(input.Bucket).toBe('test-bucket');
    expect(input.Key).toBe('documents/a/b.enc');
    expect(input.ServerSideEncryption).toBe('AES256');
    expect(Buffer.from(input.Body as Buffer).toString()).toBe('xyz');
  });

  it('gets a Buffer', async () => {
    const body = {
      transformToByteArray: () => Promise.resolve(new Uint8Array(Buffer.from('hello'))),
    } as never;
    s3Mock.on(GetObjectCommand).resolves({ Body: body });
    const out = await createS3Driver(config).get('k');
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString()).toBe('hello');
  });

  it('maps NoSuchKey to NotFoundError', async () => {
    s3Mock.on(GetObjectCommand).rejects(Object.assign(new Error('nope'), { name: 'NoSuchKey' }));
    await expect(createS3Driver(config).get('missing')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('deletes', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    await createS3Driver(config).delete('k');
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });
});
