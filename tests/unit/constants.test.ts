import { describe, it, expect } from 'vitest';
import {
  APPLICATION_STAGE_ORDER,
  APPLICATION_STAGE_LABELS,
  stageIndex,
  STUDENT_UPLOAD_DOCUMENT_TYPES,
  WAYLEN_ISSUED_DOCUMENT_TYPES,
  INITIAL_DESTINATIONS,
} from '../../src/config/constants.js';

describe('application stages (PRD §5.3)', () => {
  it('matches the PRD order exactly', () => {
    expect(APPLICATION_STAGE_ORDER).toEqual([
      'PROFILE_CREATED',
      'DOCUMENTS_SUBMITTED',
      'UNDER_REVIEW',
      'APPLICATION_SUBMITTED',
      'OFFER_RECEIVED',
      'VISA_PROCESSING',
      'ENROLLED',
    ]);
  });

  it('has a label for every stage', () => {
    for (const stage of APPLICATION_STAGE_ORDER) {
      expect(APPLICATION_STAGE_LABELS[stage]).toBeTruthy();
    }
  });

  it('orders stages so progress comparisons work', () => {
    expect(stageIndex('PROFILE_CREATED')).toBeLessThan(stageIndex('OFFER_RECEIVED'));
    expect(stageIndex('ENROLLED')).toBe(APPLICATION_STAGE_ORDER.length - 1);
  });
});

describe('document type split (PRD §5.2)', () => {
  it('keeps student uploads and Waylen-issued documents disjoint', () => {
    // A student must never be able to upload an "offer letter" themselves.
    const overlap = STUDENT_UPLOAD_DOCUMENT_TYPES.filter((type) =>
      WAYLEN_ISSUED_DOCUMENT_TYPES.includes(type),
    );
    expect(overlap).toEqual([]);
  });
});

describe('initial destinations (PRD §4.3)', () => {
  it('covers the seven launch countries', () => {
    const names = INITIAL_DESTINATIONS.map((d) => d.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Poland',
        'Latvia',
        'Lithuania',
        'Romania',
        'Bulgaria',
        'Ireland',
        'Canada',
      ]),
    );
    expect(names).toHaveLength(7);
  });
});
