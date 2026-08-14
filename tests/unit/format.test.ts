import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  formatTuitionRange,
  formatFileSize,
  truncate,
  humaniseEnum,
  initials,
} from '../../src/utils/format.js';

describe('formatMoney', () => {
  it('renders minor units as major currency', () => {
    expect(formatMoney(150_000, 'EUR')).toBe('€1,500.00');
  });

  it('handles zero without dropping the decimals', () => {
    expect(formatMoney(0, 'EUR')).toBe('€0.00');
  });
});

describe('formatTuitionRange', () => {
  it('renders a range when min and max differ', () => {
    expect(formatTuitionRange(200_000, 450_000, 'EUR')).toBe('€2,000.00 – €4,500.00');
  });

  it('collapses to a single figure when they match', () => {
    expect(formatTuitionRange(300_000, 300_000, 'EUR')).toBe('€3,000.00');
  });

  it('falls back to "On enquiry" when neither is set', () => {
    expect(formatTuitionRange(null, null)).toBe('On enquiry');
  });

  it('uses whichever bound is present', () => {
    expect(formatTuitionRange(null, 500_000, 'EUR')).toBe('€5,000.00');
  });
});

describe('formatFileSize', () => {
  it('scales through the units', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(3_145_728)).toBe('3.0 MB');
  });
});

describe('truncate', () => {
  it('leaves short strings untouched', () => {
    expect(truncate('Short', 20)).toBe('Short');
  });

  it('cuts on a word boundary', () => {
    // The ellipsis must not land mid-word.
    expect(truncate('Waylen guides ambitious people abroad', 20)).toBe('Waylen guides…');
  });
});

describe('humaniseEnum', () => {
  it('turns SCREAMING_SNAKE into readable text', () => {
    expect(humaniseEnum('OFFER_RECEIVED')).toBe('Offer Received');
    expect(humaniseEnum('VISA_PROCESSING')).toBe('Visa Processing');
  });
});

describe('initials', () => {
  it('takes the first two names only', () => {
    expect(initials('Blessing Chinowoneka')).toBe('BC');
    expect(initials('Mary Jane Watson')).toBe('MJ');
  });

  it('handles a single name', () => {
    expect(initials('Bee')).toBe('B');
  });
});
