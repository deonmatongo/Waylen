/**
 * Multipart upload handling for the Document Centre (PRD §5.2).
 *
 * Files are buffered in memory and handed to the storage service, which
 * encrypts before writing (PRD §8.2). They are deliberately never written
 * straight into a web-served directory.
 */
import multer from 'multer';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { env } from '../config/env.js';
import { ALLOWED_UPLOAD_MIME_TYPES } from '../config/constants.js';
import { ValidationError } from '../utils/errors.js';

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.mimetype as never)) {
    cb(
      new ValidationError(
        'That file type is not accepted. Please upload a PDF, JPG, PNG or Word document.',
      ),
    );
    return;
  }
  cb(null, true);
}

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 5 },
  fileFilter,
});

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

const REJECTION_MESSAGE =
  'That file does not look like a real PDF, JPG, PNG or Word document. Please check it and try again.';

/**
 * Identifies a file by its leading bytes rather than by what the client
 * claims. The declared MIME type and filename are attacker-controlled, so an
 * HTML or script payload renamed to `passport.pdf` would otherwise be stored
 * and later served back with a trusted type.
 *
 * Returns one of `ALLOWED_UPLOAD_MIME_TYPES`, or null when the bytes match
 * none of them.
 */
export function sniffMimeType(buffer: Buffer): (typeof ALLOWED_UPLOAD_MIME_TYPES)[number] | null {
  if (buffer.length < 8) return null;

  // %PDF-
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

  // HEIC/HEIF: an ISO-BMFF `ftyp` box at offset 4 with a HEIF major brand.
  if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('latin1').toLowerCase();
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
    return null;
  }

  // Legacy Word (.doc): OLE2 compound file header.
  if (buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return 'application/msword';
  }

  // .docx is a ZIP (PK\x03\x04) whose first entries name the OPC parts. A bare
  // ZIP — or an .xlsx/.jar — must not pass as a Word document.
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    const head = buffer.subarray(0, Math.min(buffer.length, 8192)).toString('latin1');
    if (head.includes('[Content_Types].xml') && head.includes('word/')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
  }

  return null;
}

/**
 * Runs after multer has buffered the upload. Rejects any file whose real
 * content type disagrees with the declared one, and pins `file.mimetype` to
 * the verified type so everything downstream (storage, the DB row, download
 * headers) only ever sees a value we established ourselves.
 */
export function verifyUploadedFiles(req: Request): void {
  const files: Express.Multer.File[] = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  else if (req.files) files.push(...Object.values(req.files).flat());

  for (const file of files) {
    const detected = file.buffer ? sniffMimeType(file.buffer) : null;
    if (!detected || detected !== file.mimetype) throw new ValidationError(REJECTION_MESSAGE);
    file.mimetype = detected;
  }
}

function withVerification(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (err?: unknown) => {
      if (err) return next(err);
      try {
        verifyUploadedFiles(req);
        next();
      } catch (verificationError) {
        next(verificationError);
      }
    });
  };
}

/** Single-file document upload, field name `document`. */
export const singleDocument = withVerification(documentUpload.single('document'));

/** Multi-file upload for bulk submission, field name `documents`. */
export const multipleDocuments = withVerification(documentUpload.array('documents', 5));
