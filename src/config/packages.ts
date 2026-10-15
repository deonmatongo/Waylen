/**
 * Packages (client navigation feedback, Services §6.1). Waylen has one
 * package today — this is still structured as a lookup rather than a
 * constant so a second package is a new array entry plus a real
 * `currentPackageFor` (keyed on a future `student.packageId`), not a redesign
 * of the Services page.
 */

/** Single source of truth for fallback currency; other modules should import this rather than hardcoding 'EUR'. */
export const DEFAULT_CURRENCY = 'EUR';

/** One service a package covers, with how the student gets it. */
export interface PackageInclusion {
  serviceSlug: string;
  /** Short plain-language note on what is covered, shown beside the service. */
  coverage: string;
}

export interface PackageDefinition {
  id: string;
  name: string;
  summary: string;
  /** Position in the tier ladder (1 = entry). Only one tier exists today. */
  tier: number;
  /** Structured per-service inclusion data. Prices are deliberately absent: none are defined in config. */
  inclusions: PackageInclusion[];
  /** Slugs into SERVICE_CATALOGUE — kept here too so a future package can include a different set. */
  includedServiceSlugs: string[];
}

export const PACKAGES: PackageDefinition[] = [
  {
    id: 'guided',
    name: 'Waylen Guided',
    summary:
      'End-to-end support from your first consultation through to enrolment — a dedicated counsellor, application and document support, and career guidance along the way.',
    tier: 1,
    inclusions: [
      { serviceSlug: 'university-applications', coverage: 'Application preparation and submission support' },
      { serviceSlug: 'career-guidance', coverage: 'Career assessment and guidance' },
      { serviceSlug: 'consultation-booking', coverage: 'Consultations with your counsellor' },
      { serviceSlug: 'document-review', coverage: 'Review of your application documents' },
    ],
    includedServiceSlugs: ['university-applications', 'career-guidance', 'consultation-booking', 'document-review'],
  },
];

/** Slugs of services not covered by the package, i.e. add-ons. */
export function addOnSlugsFor(pkg: PackageDefinition, allServiceSlugs: string[]): string[] {
  const included = new Set(pkg.inclusions.map((i) => i.serviceSlug));
  return allServiceSlugs.filter((slug) => !included.has(slug));
}

/** Every student is on the one package today; this is the seam for a real per-student lookup later. */
export function currentPackageFor(_student: unknown): PackageDefinition {
  return PACKAGES[0]!;
}
