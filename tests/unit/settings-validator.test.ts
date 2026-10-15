import { describe, it, expect } from 'vitest';
import { validateSettings } from '../../src/validators/settings.validator.js';

describe('validateSettings', () => {
  it('accepts allow-listed keys and ignores _csrf', () => {
    expect(
      validateSettings({
        _csrf: 'x',
        'contact.email': ' hello@waylen.example ',
        'social.linkedin': 'https://linkedin.com/company/waylen',
        'consultation.duration_minutes': '45',
      }),
    ).toEqual([
      ['contact.email', 'hello@waylen.example'],
      ['social.linkedin', 'https://linkedin.com/company/waylen'],
      ['consultation.duration_minutes', '45'],
    ]);
  });

  it('rejects unknown keys, including prototype names', () => {
    expect(() => validateSettings({ 'feature.flag': 'on' })).toThrow(/not a setting/);
    expect(() => validateSettings({ constructor: 'x' })).toThrow(/not a setting/);
  });

  it('rejects bad values', () => {
    expect(() => validateSettings({ 'contact.email': 'nope' })).toThrow();
    expect(() => validateSettings({ 'social.instagram': 'http://instagram.com/x' })).toThrow(/https/);
    expect(() => validateSettings({ 'social.instagram': 'javascript:alert(1)' })).toThrow();
    expect(() => validateSettings({ 'contact.phone': 'x'.repeat(41) })).toThrow();
    expect(() => validateSettings({ 'consultation.duration_minutes': '0' })).toThrow();
    expect(() => validateSettings({ 'contact.phone': ['a', 'b'] })).toThrow();
  });

  it('lets a social link be cleared', () => {
    expect(validateSettings({ 'social.linkedin': '' })).toEqual([['social.linkedin', '']]);
  });
});
