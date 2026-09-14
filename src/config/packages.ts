/**
 * Packages (client navigation feedback, Services §6.1). Waylen has one
 * package today — this is still structured as a lookup rather than a
 * constant so a second package is a new array entry plus a real
 * `currentPackageFor` (keyed on a future `student.packageId`), not a redesign
 * of the Services page.
 */
export interface PackageDefinition {
  id: string;
  name: string;
  summary: string;
  /** Slugs into SERVICE_CATALOGUE — kept here too so a future package can include a different set. */
  includedServiceSlugs: string[];
}

export const PACKAGES: PackageDefinition[] = [
  {
    id: 'guided',
    name: 'Waylen Guided',
    summary:
      'End-to-end support from your first consultation through to enrolment — a dedicated counsellor, application and document support, and career guidance along the way.',
    includedServiceSlugs: ['university-applications', 'career-guidance', 'consultation-booking', 'document-review'],
  },
];

/** Every student is on the one package today; this is the seam for a real per-student lookup later. */
export function currentPackageFor(_student: unknown): PackageDefinition {
  return PACKAGES[0]!;
}
