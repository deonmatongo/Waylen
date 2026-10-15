/**
 * Platform settings validation (super admin).
 *
 * Only the keys below can be written. They mirror the settings seeded in
 * `prisma/seed.ts` and rendered by `views/admin/settings` — an unknown key is
 * rejected rather than upserted, so a forged form field can never create
 * arbitrary settings rows.
 */
import { ValidationError } from '../utils/errors.js';

type SettingRule =
  | { kind: 'text'; max: number }
  | { kind: 'email' }
  | { kind: 'url' }
  | { kind: 'int'; min: number; max: number };

export const SETTING_RULES: Record<string, SettingRule> = {
  'contact.email': { kind: 'email' },
  'contact.phone': { kind: 'text', max: 40 },
  'contact.whatsapp': { kind: 'text', max: 40 },
  'contact.office.primary': { kind: 'text', max: 200 },
  'contact.office.secondary': { kind: 'text', max: 200 },
  'social.linkedin': { kind: 'url' },
  'social.instagram': { kind: 'url' },
  'consultation.duration_minutes': { kind: 'int', min: 5, max: 480 },
};

const FORM_ONLY_KEYS = new Set(['_csrf']);

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Returns the validated `[key, value]` pairs to store, or throws a
 * ValidationError naming the first offending setting.
 */
export function validateSettings(body: unknown): [string, string][] {
  const source = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const out: [string, string][] = [];

  for (const [key, raw] of Object.entries(source)) {
    if (FORM_ONLY_KEYS.has(key)) continue;

    const rule = Object.hasOwn(SETTING_RULES, key) ? SETTING_RULES[key] : undefined;
    if (!rule) throw new ValidationError(`"${key}" is not a setting that can be changed.`);
    if (typeof raw !== 'string') throw new ValidationError(`"${key}" must be a single text value.`);

    const value = raw.trim();

    switch (rule.kind) {
      case 'text':
        if (value.length > rule.max) {
          throw new ValidationError(`"${key}" must be ${rule.max} characters or fewer.`);
        }
        break;
      case 'email':
        if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          throw new ValidationError(`"${key}" must be a valid email address.`);
        }
        break;
      case 'url':
        // Empty clears the link; anything else must be https.
        if (value && (value.length > 300 || !isHttpsUrl(value))) {
          throw new ValidationError(`"${key}" must be a full https:// URL.`);
        }
        break;
      case 'int':
        if (!/^\d+$/.test(value) || Number(value) < rule.min || Number(value) > rule.max) {
          throw new ValidationError(`"${key}" must be a whole number from ${rule.min} to ${rule.max}.`);
        }
        break;
    }

    out.push([key, value]);
  }

  return out;
}
