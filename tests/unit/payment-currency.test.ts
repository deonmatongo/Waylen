import { describe, it, expect } from 'vitest';
import { majorToMinor, minorToMajor } from '../../src/services/payments/currency.js';

describe('payment currency helpers', () => {
  it('treats two-decimal currencies as cents', () => {
    expect(minorToMajor(1050, 'EUR')).toBe('10.50');
    expect(majorToMinor(10.5, 'NGN')).toBe(1050);
  });

  it('leaves zero-decimal currencies unscaled', () => {
    expect(minorToMajor(5000, 'UGX')).toBe('5000');
    expect(majorToMinor(5000, 'xof')).toBe(5000);
    expect(minorToMajor(300, 'JPY')).toBe('300');
  });
});
