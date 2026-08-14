/**
 * Audit trail (PRD §8.2 — "an audit trail for who accessed or changed a
 * student record").
 *
 * Append-only. There is deliberately no update or delete method: an audit log
 * that can be edited is not an audit log.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  studentProfileId?: string | null;
  changes?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Fields that must never be written into `changes`. */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'mfaSecret',
  'verificationToken',
  'passwordResetToken',
  'encryptionIv',
  'storageKey',
  'cardNumber',
  'cvc',
]);

function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      key,
      REDACTED_FIELDS.has(key) ? '[redacted]' : redact(val),
    ]),
  );
}

export const auditService = {
  async record(entry: AuditEntry): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        studentProfileId: entry.studentProfileId ?? null,
        changes: entry.changes ? (redact(entry.changes) as Prisma.InputJsonValue) : undefined,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  },

  /**
   * Records a field-level diff. Only changed fields are stored, so the log
   * stays readable when a form posts back every field unchanged.
   */
  async recordUpdate(
    entry: Omit<AuditEntry, 'changes' | 'action'>,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    for (const key of Object.keys(after)) {
      if (before[key] !== after[key]) {
        diff[key] = { from: before[key], to: after[key] };
      }
    }

    if (Object.keys(diff).length === 0) return;

    await this.record({ ...entry, action: 'UPDATE', changes: diff as Prisma.InputJsonValue });
  },

  /** Per-student history, for the student detail page and DSAR requests. */
  async listForStudent(studentProfileId: string, limit = 100) {
    return prisma.auditLog.findMany({
      where: { studentProfileId },
      include: { actor: { select: { fullName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  async list(filters: {
    actorId?: string;
    entity?: string;
    action?: string;
    from?: Date;
    to?: Date;
    page?: number;
    perPage?: number;
  } = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const perPage = Math.min(200, filters.perPage ?? 50);

    const where: Prisma.AuditLogWhereInput = {
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.entity ? { entity: filters.entity } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.from || filters.to
        ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { fullName: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, perPage, totalPages: Math.ceil(total / perPage) };
  },
};
