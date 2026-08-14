/**
 * Audit trail middleware (PRD §8.2).
 *
 * Wraps a route so that a successful response records who touched which
 * student record. Writes are fire-and-forget: an audit failure must never
 * break the user's request, but it is logged loudly.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { auditService } from '../services/audit.service.js';
import { logger } from '../config/logger.js';

type AuditAction = 'VIEW' | 'CREATE' | 'UPDATE' | 'DELETE' | 'DOWNLOAD' | 'EXPORT';

interface AuditOptions {
  action: AuditAction;
  entity: string;
  /** Pulls the entity id out of the request, usually a route param. */
  entityId?: (req: Request) => string | undefined;
  /** Pulls the student whose record is being touched. */
  studentProfileId?: (req: Request) => string | undefined;
}

export function audit(options: AuditOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      if (res.statusCode >= 400) return;

      void auditService
        .record({
          actorId: req.currentUser?.id ?? null,
          action: options.action,
          entity: options.entity,
          entityId: options.entityId?.(req) ?? null,
          studentProfileId: options.studentProfileId?.(req) ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
        })
        .catch((err) => logger.error({ err }, 'Failed to write audit entry'));
    });

    next();
  };
}
