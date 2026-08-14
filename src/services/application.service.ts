/**
 * Application lifecycle and the Progress Tracker (PRD §5.2, §5.3, §5.4).
 *
 * Every stage change writes three things atomically: the application row, an
 * append-only timeline event, and the denormalised rollup on the student
 * profile. They must not drift apart, hence the transaction.
 */
import type { ApplicationStage, ApplicationOutcome } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import {
  APPLICATION_STAGE_ORDER,
  APPLICATION_STAGE_LABELS,
  stageIndex,
} from '../config/constants.js';
import { applicationReference } from '../utils/reference.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { notificationService } from './notification.service.js';
import { auditService } from './audit.service.js';

export interface ProgressStep {
  stage: ApplicationStage;
  label: string;
  status: 'complete' | 'current' | 'upcoming';
  reachedAt: Date | null;
}

export const applicationService = {
  async create(input: {
    studentProfileId: string;
    opportunityId?: string;
    countryId?: string;
    institutionId?: string;
    programmeName?: string;
    studyLevel?: string;
    intakePeriod?: string;
    createdById?: string;
  }) {
    const application = await prisma.$transaction(async (tx) => {
      const created = await tx.application.create({
        data: {
          reference: applicationReference(),
          studentProfileId: input.studentProfileId,
          opportunityId: input.opportunityId ?? null,
          countryId: input.countryId ?? null,
          institutionId: input.institutionId ?? null,
          programmeName: input.programmeName ?? null,
          studyLevel: (input.studyLevel as never) ?? null,
          intakePeriod: input.intakePeriod ?? null,
          stage: 'PROFILE_CREATED',
        },
      });

      await tx.applicationEvent.create({
        data: {
          applicationId: created.id,
          stage: 'PROFILE_CREATED',
          note: 'Application created',
          actorId: input.createdById ?? null,
        },
      });

      return created;
    });

    logger.info({ applicationId: application.id, reference: application.reference }, 'Application created');
    return application;
  },

  /**
   * Advances (or corrects) the stage of an application.
   *
   * Backwards moves are permitted — a rejected document legitimately sends a
   * student back to DOCUMENTS_SUBMITTED — but they are recorded as such so the
   * timeline stays truthful.
   */
  async changeStage(
    applicationId: string,
    stage: ApplicationStage,
    options: { actorId?: string; note?: string; notifyStudent?: boolean } = {},
  ) {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        reference: true,
        stage: true,
        programmeName: true,
        studentProfileId: true,
        studentProfile: { select: { userId: true, currentStage: true } },
      },
    });

    if (!application) throw new NotFoundError('That application could not be found.');
    if (application.stage === stage) return application;

    const movingBackwards = stageIndex(stage) < stageIndex(application.stage);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.application.update({
        where: { id: applicationId },
        data: {
          stage,
          ...(stage === 'APPLICATION_SUBMITTED' ? { submittedAt: new Date() } : {}),
          ...(stage === 'OFFER_RECEIVED' ? { decisionAt: new Date() } : {}),
        },
      });

      await tx.applicationEvent.create({
        data: {
          applicationId,
          stage,
          note:
            options.note ??
            (movingBackwards
              ? `Returned to ${APPLICATION_STAGE_LABELS[stage]}`
              : `Advanced to ${APPLICATION_STAGE_LABELS[stage]}`),
          actorId: options.actorId ?? null,
        },
      });

      // The profile rollup tracks the student's furthest-along application, so
      // one application slipping back does not drag the whole profile with it.
      const furthest = await tx.application.findMany({
        where: { studentProfileId: application.studentProfileId },
        select: { stage: true },
      });
      const furthestStage = furthest.reduce<ApplicationStage>(
        (best, row) => (stageIndex(row.stage) > stageIndex(best) ? row.stage : best),
        'PROFILE_CREATED',
      );

      await tx.studentProfile.update({
        where: { id: application.studentProfileId },
        data: {
          currentStage: furthestStage,
          ...(furthestStage === 'ENROLLED' ? { isAlumni: true } : {}),
        },
      });

      return result;
    });

    await auditService.record({
      actorId: options.actorId ?? null,
      action: 'UPDATE',
      entity: 'Application',
      entityId: applicationId,
      studentProfileId: application.studentProfileId,
      changes: { stage: { from: application.stage, to: stage } },
    });

    if (options.notifyStudent !== false) {
      const isOffer = stage === 'OFFER_RECEIVED';
      await notificationService.dispatch({
        userId: application.studentProfile.userId,
        event: isOffer ? 'application.offer_received' : 'application.stage_changed',
        title: isOffer
          ? 'You have received an offer'
          : `Your application is now: ${APPLICATION_STAGE_LABELS[stage]}`,
        body: options.note ?? undefined,
        actionUrl: `/portal/applications/${applicationId}`,
        emailTemplate: 'application-update',
        emailData: {
          reference: application.reference,
          programmeName: application.programmeName,
          stageLabel: APPLICATION_STAGE_LABELS[stage],
        },
      });
    }

    return updated;
  },

  async setOutcome(
    applicationId: string,
    outcome: ApplicationOutcome,
    options: { actorId?: string; institutionNotes?: string } = {},
  ) {
    const application = await prisma.application.update({
      where: { id: applicationId },
      data: {
        outcome,
        decisionAt: new Date(),
        ...(options.institutionNotes ? { institutionNotes: options.institutionNotes } : {}),
      },
      select: { id: true, studentProfileId: true },
    });

    // An outcome implies a stage; keep the tracker consistent with the decision.
    const impliedStage: Partial<Record<ApplicationOutcome, ApplicationStage>> = {
      OFFER_UNCONDITIONAL: 'OFFER_RECEIVED',
      OFFER_CONDITIONAL: 'OFFER_RECEIVED',
      ENROLLED: 'ENROLLED',
    };

    const next = impliedStage[outcome];
    if (next) {
      await this.changeStage(applicationId, next, { actorId: options.actorId });
    }

    await auditService.record({
      actorId: options.actorId ?? null,
      action: 'UPDATE',
      entity: 'Application',
      entityId: applicationId,
      studentProfileId: application.studentProfileId,
      changes: { outcome: { to: outcome } },
    });

    return application;
  },

  /**
   * Builds the seven-step tracker for a view (PRD §5.3). Reached timestamps
   * come from the event timeline, so the display is derived rather than stored.
   */
  async buildProgress(applicationId: string): Promise<ProgressStep[]> {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      select: {
        stage: true,
        events: {
          select: { stage: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!application) throw new NotFoundError('That application could not be found.');

    // First time each stage was reached.
    const reached = new Map<ApplicationStage, Date>();
    for (const event of application.events) {
      if (!reached.has(event.stage)) reached.set(event.stage, event.createdAt);
    }

    const currentIndex = stageIndex(application.stage);

    return APPLICATION_STAGE_ORDER.map((stage, index) => ({
      stage,
      label: APPLICATION_STAGE_LABELS[stage],
      status: index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming',
      reachedAt: reached.get(stage) ?? null,
    }));
  },

  async listForStudent(studentProfileId: string) {
    return prisma.application.findMany({
      where: { studentProfileId },
      select: {
        id: true,
        reference: true,
        programmeName: true,
        studyLevel: true,
        intakePeriod: true,
        stage: true,
        outcome: true,
        submittedAt: true,
        decisionAt: true,
        applicationDeadline: true,
        studentNotes: true,
        createdAt: true,
        country: { select: { name: true, isoCode: true, slug: true } },
        opportunity: { select: { title: true, slug: true } },
        _count: { select: { documents: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Full detail for the student's own view. `institutionNotes` and the
   * institution relation are excluded — students see Waylen's summary, not the
   * raw institutional correspondence (PRD §4.2).
   */
  async findForStudent(applicationId: string, studentProfileId: string) {
    const application = await prisma.application.findFirst({
      where: { id: applicationId, studentProfileId },
      select: {
        id: true,
        reference: true,
        programmeName: true,
        studyLevel: true,
        intakePeriod: true,
        stage: true,
        outcome: true,
        submittedAt: true,
        decisionAt: true,
        applicationDeadline: true,
        studentNotes: true,
        createdAt: true,
        country: { select: { name: true, isoCode: true, slug: true } },
        opportunity: { select: { title: true, slug: true, category: true } },
        events: {
          where: { visibleToStudent: true },
          select: { stage: true, note: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        documents: {
          select: { id: true, type: true, status: true, originalFilename: true, createdAt: true },
        },
      },
    });

    if (!application) throw new NotFoundError('That application could not be found.');
    return application;
  },

  /** Guard used by the admin submit action (PRD §5.4). */
  assertReadyToSubmit(documentStatuses: { status: string }[]): void {
    const outstanding = documentStatuses.filter((d) => d.status !== 'APPROVED');
    if (outstanding.length > 0) {
      throw new ValidationError(
        `${outstanding.length} document(s) are not yet approved. All documents must be approved before submitting to an institution.`,
      );
    }
  },
};
