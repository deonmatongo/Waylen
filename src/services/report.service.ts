/**
 * Reporting (PRD §5.4, §10).
 *
 * The metric set is taken straight from §10 so the KPIs are measurable from
 * launch rather than retrofitted once tracking is missed.
 */
import { prisma } from '../config/database.js';
import { APPLICATION_STAGE_ORDER, APPLICATION_STAGE_LABELS } from '../config/constants.js';

export const reportService = {
  async summary() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const [
      totalStudents,
      newStudents30d,
      applicationsSubmitted,
      offersReceived,
      enrolled,
      consultationsBooked30d,
      webinarRegistrations30d,
      activeReferrals30d,
    ] = await Promise.all([
      prisma.studentProfile.count(),
      prisma.studentProfile.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.application.count({ where: { submittedAt: { not: null } } }),
      prisma.application.count({
        where: { outcome: { in: ['OFFER_UNCONDITIONAL', 'OFFER_CONDITIONAL'] } },
      }),
      prisma.application.count({ where: { outcome: 'ENROLLED' } }),
      prisma.appointment.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.webinarRegistration.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.referral.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    ]);

    return {
      totalStudents,
      newStudents30d,
      applicationsSubmitted,
      offersReceived,
      enrolled,
      consultationsBooked30d,
      webinarRegistrations30d,
      activeReferrals30d,
      // PRD §10 — application-to-offer conversion.
      offerConversionRate:
        applicationsSubmitted > 0 ? Math.round((offersReceived / applicationsSubmitted) * 100) : 0,
      enrolmentConversionRate:
        offersReceived > 0 ? Math.round((enrolled / offersReceived) * 100) : 0,
    };
  },

  /** Stage-by-stage counts across the PRD §5.3 pipeline. */
  async studentFunnel() {
    const rows = await prisma.studentProfile.groupBy({
      by: ['currentStage'],
      _count: { _all: true },
    });
    const counts = new Map(rows.map((r) => [r.currentStage, r._count._all]));

    return APPLICATION_STAGE_ORDER.map((stage) => ({
      stage,
      label: APPLICATION_STAGE_LABELS[stage],
      count: counts.get(stage) ?? 0,
    }));
  },

  async applicationConversion() {
    const [byOutcome, avgDaysToOffer] = await Promise.all([
      prisma.application.groupBy({ by: ['outcome'], _count: { _all: true } }),
      // Average days from submission to decision, for applications that got
      // one. SQLite stores DateTime as milliseconds-since-epoch integers, so
      // the difference divided by a day in ms gives the day count directly —
      // no EXTRACT/EPOCH (that's Postgres syntax, and this project runs on
      // SQLite, prisma/schema.prisma's actual datasource).
      prisma.$queryRaw<{ avg_days: number | null }[]>`
        SELECT AVG(("decisionAt" - "submittedAt") / 86400000.0) AS avg_days
        FROM applications
        WHERE "submittedAt" IS NOT NULL AND "decisionAt" IS NOT NULL
      `,
    ]);

    return {
      byOutcome: byOutcome.map((row) => ({ outcome: row.outcome, count: row._count._all })),
      averageDaysToDecision: Math.round(avgDaysToOffer[0]?.avg_days ?? 0),
    };
  },

  /** PRD §10 — popular destinations. */
  async popularDestinations() {
    const rows = await prisma.application.groupBy({
      by: ['countryId'],
      where: { countryId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { countryId: 'desc' } },
      take: 20,
    });

    const countries = await prisma.country.findMany({
      where: { id: { in: rows.map((r) => r.countryId!).filter(Boolean) } },
      select: { id: true, name: true, isoCode: true },
    });
    const nameById = new Map(countries.map((c) => [c.id, c]));

    return rows.map((row) => ({
      country: nameById.get(row.countryId!)?.name ?? 'Unknown',
      isoCode: nameById.get(row.countryId!)?.isoCode ?? null,
      applications: row._count._all,
    }));
  },

  /** PRD §10 — consultation fees, application fees, insurance, commissions. */
  async revenue() {
    const [byCategory, commissions, outstanding] = await Promise.all([
      prisma.invoiceLineItem.groupBy({
        by: ['category'],
        _sum: { totalMinor: true },
        _count: { _all: true },
      }),
      prisma.referral.aggregate({
        where: { status: 'CONVERTED' },
        _sum: { commissionAmountMinor: true },
        _count: { _all: true },
      }),
      prisma.invoice.aggregate({
        where: { status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
        _sum: { totalMinor: true, paidMinor: true },
      }),
    ]);

    return {
      byCategory: byCategory.map((row) => ({
        category: row.category ?? 'Uncategorised',
        totalMinor: row._sum.totalMinor ?? 0,
        count: row._count._all,
      })),
      commissionsMinor: commissions._sum.commissionAmountMinor ?? 0,
      commissionCount: commissions._count._all,
      outstandingMinor:
        (outstanding._sum.totalMinor ?? 0) - (outstanding._sum.paidMinor ?? 0),
    };
  },

  /**
   * CSV export. Values are quoted and embedded quotes doubled so a name
   * containing a comma cannot break the column layout.
   */
  async exportCsv(type: string): Promise<{ rows: string; filename: string }> {
    const escape = (value: unknown): string => {
      // Objects would otherwise land in the spreadsheet as "[object Object]".
      // Dates are the case that actually occurs here, so render them as ISO.
      let str: string;
      if (value == null) str = '';
      else if (value instanceof Date) str = value.toISOString();
      else if (typeof value === 'string') str = value;
      else if (typeof value === 'number' || typeof value === 'boolean') str = value.toString();
      else if (typeof value === 'bigint') str = value.toString();
      else str = JSON.stringify(value) ?? '';

      return `"${str.replace(/"/g, '""')}"`;
    };
    const toCsv = (headers: string[], data: unknown[][]): string =>
      [headers.map(escape).join(','), ...data.map((row) => row.map(escape).join(','))].join('\n');

    if (type === 'applications') {
      const applications = await prisma.application.findMany({
        select: {
          reference: true,
          programmeName: true,
          stage: true,
          outcome: true,
          submittedAt: true,
          decisionAt: true,
          country: { select: { name: true } },
          studentProfile: { select: { reference: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        filename: 'waylen-applications.csv',
        rows: toCsv(
          ['Reference', 'Student', 'Programme', 'Country', 'Stage', 'Outcome', 'Submitted', 'Decision'],
          applications.map((a) => [
            a.reference,
            a.studentProfile.reference,
            a.programmeName,
            a.country?.name,
            a.stage,
            a.outcome,
            a.submittedAt?.toISOString(),
            a.decisionAt?.toISOString(),
          ]),
        ),
      };
    }

    // Default: the student register.
    const students = await prisma.studentProfile.findMany({
      select: {
        reference: true,
        currentStage: true,
        createdAt: true,
        user: { select: { fullName: true, email: true } },
        countryOfOrigin: { select: { name: true } },
        assignedCounsellor: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      filename: 'waylen-students.csv',
      rows: toCsv(
        ['Reference', 'Name', 'Email', 'Country of origin', 'Stage', 'Counsellor', 'Registered'],
        students.map((s) => [
          s.reference,
          s.user.fullName,
          s.user.email,
          s.countryOfOrigin?.name,
          s.currentStage,
          s.assignedCounsellor?.fullName,
          s.createdAt.toISOString(),
        ]),
      ),
    };
  },
};
