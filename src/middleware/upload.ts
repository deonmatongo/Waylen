/**
 * Multipart upload handling for the Document Centre (PRD §5.2).
 *
 * Files are buffered in memory and handed to the storage service, which
 * encrypts before writing (PRD §8.2). They are deliberately never written
 * straight into a web-served directory.
 */
import multer from 'multer';
import type { Request } from 'express';
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

/** Single-file document upload, field name `document`. */
export const singleDocument = documentUpload.single('document');

/** Multi-file upload for bulk submission, field name `documents`. */
export const multipleDocuments = documentUpload.array('documents', 5);
