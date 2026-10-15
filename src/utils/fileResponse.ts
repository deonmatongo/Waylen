/**
 * Safe delivery of stored documents.
 *
 * Every download path (portal and back-office) goes through `sendStoredFile`
 * so the headers are built in exactly one place: an RFC 6266/5987
 * Content-Disposition that cannot be broken out of by a hostile filename, a
 * Content-Type restricted to the types we accept on upload, and `attachment`
 * for anything a browser could execute or render actively.
 */
import type { Response } from 'express';
import { ALLOWED_UPLOAD_MIME_TYPES } from '../config/constants.js';

/** Types a browser can safely render in place when inline viewing is wanted. */
const INLINE_SAFE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

/**
 * `Content-Disposition` with both a plain ASCII `filename` fallback and an
 * RFC 5987 `filename*` carrying the real UTF-8 name.
 */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  // CR/LF and path separators have no place in a header value or a save-as name.
  const cleaned = filename.replace(/[\r\n]/g, ' ').replace(/[\\/]/g, '_').trim() || 'download';

  const fallback = cleaned
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\%;]/g, '_');

  // encodeURIComponent leaves ' ( ) * unescaped, which RFC 5987 does not allow
  // in attr-char for `'`, and which some parsers mishandle for the others.
  const encoded = encodeURIComponent(cleaned).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function sendStoredFile(
  res: Response,
  file: { buffer: Buffer; filename: string; mimeType: string },
  options: { inline?: boolean } = {},
): void {
  // Rows written before upload sniffing existed carry a client-declared type.
  // Anything outside the accepted list is served as opaque bytes.
  const known = (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(file.mimeType);
  const mimeType = known ? file.mimeType : 'application/octet-stream';
  const inline = Boolean(options.inline) && INLINE_SAFE_TYPES.has(mimeType);

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', file.filename));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Confidential — never cached by an intermediary (PRD §8.2).
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.buffer);
}
