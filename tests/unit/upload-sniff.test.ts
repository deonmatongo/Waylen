import { describe, it, expect } from 'vitest';
import { sniffMimeType, verifyUploadedFiles } from '../../src/middleware/upload.js';
import { contentDisposition } from '../../src/utils/fileResponse.js';
import type { Request } from 'express';

const pad = (head: number[] | string, total = 64): Buffer => {
  const start = typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head);
  return Buffer.concat([start, Buffer.alloc(Math.max(0, total - start.length))]);
};

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('sniffMimeType', () => {
  it('recognises each accepted type by its magic bytes', () => {
    expect(sniffMimeType(pad('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffMimeType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMimeType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMimeType(pad([0, 0, 0, 0x18, ...Buffer.from('ftypheic')]))).toBe('image/heic');
    expect(sniffMimeType(pad([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe('application/msword');
    expect(sniffMimeType(pad('PK\x03\x04....[Content_Types].xml....word/document.xml'))).toBe(DOCX);
  });

  it('rejects content that matches no accepted signature', () => {
    expect(sniffMimeType(pad('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffMimeType(pad('#!/bin/sh\n'))).toBeNull();
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull();
    // A bare ZIP / non-HEIF ISO-BMFF file must not pass as docx / heic.
    expect(sniffMimeType(pad('PK\x03\x04plain zip with a.txt'))).toBeNull();
    expect(sniffMimeType(pad([0, 0, 0, 0x18, ...Buffer.from('ftypmp42')]))).toBeNull();
  });
});

describe('verifyUploadedFiles', () => {
  const fileOf = (buffer: Buffer, mimetype: string) =>
    ({ buffer, mimetype, originalname: 'x' }) as Express.Multer.File;

  it('accepts a matching file and pins the verified type', () => {
    const file = fileOf(pad('%PDF-1.4'), 'application/pdf');
    expect(() => verifyUploadedFiles({ file } as Request)).not.toThrow();
    expect(file.mimetype).toBe('application/pdf');
  });

  it('rejects a declared type that disagrees with the bytes', () => {
    const file = fileOf(pad('<html>'), 'application/pdf');
    expect(() => verifyUploadedFiles({ file } as Request)).toThrow();
    const png = fileOf(pad('%PDF-1.4'), 'image/png');
    expect(() => verifyUploadedFiles({ file: png } as Request)).toThrow();
  });

  it('checks every file of a multi-file upload', () => {
    const ok = fileOf(pad('%PDF-1.4'), 'application/pdf');
    const bad = fileOf(pad('MZ....'), 'application/pdf');
    expect(() => verifyUploadedFiles({ files: [ok, bad] } as unknown as Request)).toThrow();
  });
});

describe('contentDisposition', () => {
  it('emits an ASCII fallback plus an RFC 5987 filename*', () => {
    const header = contentDisposition('attachment', 'Résumé (final).pdf');
    expect(header).toBe(
      `attachment; filename="R_sum_ (final).pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%28final%29.pdf`,
    );
  });

  it('cannot be broken out of with quotes or newlines', () => {
    const header = contentDisposition('inline', 'a"; filename=evil.html\r\nX-Injected: 1');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.match(/"/g)).toHaveLength(2);
  });
});
