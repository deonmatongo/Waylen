/**
 * Upload and download hardening beyond the basic sniffing cases in
 * upload-sniff.test.ts: spoofed MIME types, multer size/type limits through
 * the real middleware, and the headers sendStoredFile emits.
 */
import { describe, it, expect } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { singleDocument } from '../../src/middleware/upload.js';
import { contentDisposition, sendStoredFile } from '../../src/utils/fileResponse.js';
import { env } from '../../src/config/env.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)]);

/** Minimal app: the real upload middleware, then report what the controller would see. */
function uploadApp() {
  const app = express();
  app.post('/upload', singleDocument, (req: Request, res: Response) => {
    res.json({ mimetype: req.file?.mimetype, size: req.file?.size });
  });
  app.use((err: { statusCode?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode ?? (err.code?.startsWith('LIMIT_') ? 422 : 500)).json({ code: err.code ?? 'app-error' });
  });
  return app;
}

const send = (buf: Buffer, filename: string, contentType: string) =>
  request(uploadApp()).post('/upload').attach('document', buf, { filename, contentType });

describe('spoofed uploads through the real middleware', () => {
  it('accepts a genuine PDF and pins its type', async () => {
    const res = await send(PDF_BYTES, 'cv.pdf', 'application/pdf');
    expect(res.status).toBe(200);
    expect(res.body.mimetype).toBe('application/pdf');
  });

  it('rejects a Windows executable renamed .pdf', async () => {
    const exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), Buffer.alloc(128)]);
    expect((await send(exe, 'passport.pdf', 'application/pdf')).status).toBe(422);
  });

  it('rejects HTML declared as image/png', async () => {
    const html = Buffer.from('<!doctype html><script>alert(document.cookie)</script>');
    expect((await send(html, 'photo.png', 'image/png')).status).toBe(422);
  });

  it('rejects a real PDF whose declared type is something else', async () => {
    expect((await send(PDF_BYTES, 'cv.png', 'image/png')).status).toBe(422);
  });

  it('rejects a docx declared as PDF (PK header vs %PDF- mismatch)', async () => {
    const docx = Buffer.from('PK\x03\x04....[Content_Types].xml....word/document.xml' + '\0'.repeat(32), 'latin1');
    expect((await send(docx, 'cv.pdf', 'application/pdf')).status).toBe(422);
    // ...but is accepted as what it really is.
    expect((await send(docx, 'cv.docx', DOCX)).status).toBe(200);
  });

  it('rejects a bare/other-OPC zip declared as docx', async () => {
    const xlsx = Buffer.from('PK\x03\x04....[Content_Types].xml....xl/workbook.xml' + '\0'.repeat(32), 'latin1');
    expect((await send(xlsx, 'a.docx', DOCX)).status).toBe(422);
    const zip = Buffer.from('PK\x03\x04' + 'a'.repeat(100), 'latin1');
    expect((await send(zip, 'a.docx', DOCX)).status).toBe(422);
  });

  it('rejects a declared type outside the allow-list before reading the bytes', async () => {
    expect((await send(PDF_BYTES, 'run.exe', 'application/x-msdownload')).status).toBe(422);
    expect((await send(Buffer.from('<svg onload=alert(1)>'), 'a.svg', 'image/svg+xml')).status).toBe(422);
  });

  it('rejects a file over the size limit', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(env.maxUploadBytes + 1)]);
    const res = await send(big, 'huge.pdf', 'application/pdf');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('LIMIT_FILE_SIZE');
  });

  it('rejects an upload on an unexpected field name', async () => {
    const res = await request(uploadApp())
      .post('/upload')
      .attach('avatar', PDF_BYTES, { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('LIMIT_UNEXPECTED_FILE');
  });
});

describe('sendStoredFile headers', () => {
  const serve = (file: { filename: string; mimeType: string }, options?: { inline?: boolean }) => {
    const app = express();
    app.get('/f', (_req, res) => sendStoredFile(res, { buffer: Buffer.from('x'), ...file }, options));
    return request(app).get('/f');
  };

  it('never renders active content inline, even when inline is requested', async () => {
    const res = await serve({ filename: 'a.html', mimeType: 'text/html' }, { inline: true });
    expect(res.headers['content-type']).toMatch(/^application\/octet-stream/);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves a legacy row with a legacy/unknown type as opaque bytes', async () => {
    const res = await serve({ filename: 'a.pdf', mimeType: 'image/svg+xml' }, { inline: true });
    expect(res.headers['content-type']).toMatch(/^application\/octet-stream/);
  });

  it('allows inline only for pdf/jpeg/png', async () => {
    const pdf = await serve({ filename: 'a.pdf', mimeType: 'application/pdf' }, { inline: true });
    expect(pdf.headers['content-disposition']).toMatch(/^inline;/);
    const docx = await serve({ filename: 'a.docx', mimeType: DOCX }, { inline: true });
    expect(docx.headers['content-disposition']).toMatch(/^attachment;/);
    const dflt = await serve({ filename: 'a.pdf', mimeType: 'application/pdf' });
    expect(dflt.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('is private and uncacheable', async () => {
    const res = await serve({ filename: 'a.pdf', mimeType: 'application/pdf' });
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});

describe('contentDisposition (RFC 5987)', () => {
  it('encodes non-ASCII and RFC 5987 reserved characters in filename*', () => {
    const h = contentDisposition('attachment', "naïve 'q' (1)*.pdf");
    expect(h).toContain(`filename*=UTF-8''na%C3%AFve%20%27q%27%20%281%29%2A.pdf`);
    expect(h).toContain('filename="na_ve \'q\' (1)*.pdf"');
  });

  it('keeps ; " % and backslashes out of the ASCII fallback', () => {
    const fallback = /filename="([^"]*)"/.exec(contentDisposition('inline', 'a;b"c%d\\e.pdf'))?.[1];
    expect(fallback).toBe('a_b_c_d_e.pdf');
  });

  it('strips path separators so a name cannot traverse', () => {
    const h = contentDisposition('attachment', '../../etc/passwd');
    expect(h).not.toMatch(/\//);
    expect(h).toContain('.._.._etc_passwd');
  });

  it('falls back to "download" for an empty or whitespace name', () => {
    expect(contentDisposition('attachment', '  \r\n ')).toContain('filename="download"');
  });

  it('encodes CR/LF injection attempts as spaces, never as a header break', () => {
    const h = contentDisposition('attachment', 'a.pdf\r\nSet-Cookie: x=1');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).toContain('%20');
  });
});
