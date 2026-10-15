/**
 * Shared URL field rules for CMS editors. Stored URLs end up in `href`/`src`
 * attributes, so `javascript:`, `data:` and other schemes must never be accepted.
 */
import { z } from 'zod';

/** Absolute http(s) URL only. */
export const httpUrl = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => {
      try {
        const { protocol } = new URL(value);
        return protocol === 'https:' || protocol === 'http:';
      } catch {
        return false;
      }
    }, 'Enter a full http(s) URL, e.g. https://example.com');

/** An http(s) URL or a site-relative path such as `/uploads/guide.pdf`. */
export const httpUrlOrSitePath = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => {
      // `//host` is protocol-relative, not site-relative.
      if (value.startsWith('/')) return !value.startsWith('//') && !value.includes('\\');
      try {
        const { protocol } = new URL(value);
        return protocol === 'https:' || protocol === 'http:';
      } catch {
        return false;
      }
    }, 'Enter an http(s) URL or a path starting with /');
