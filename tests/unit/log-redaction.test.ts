import { describe, it, expect } from 'vitest';
import { redactUrl, serializeRequest } from '../../src/config/logger.js';
import type { IncomingMessage } from 'node:http';

describe('redactUrl', () => {
  it('masks reset and verification tokens in the path', () => {
    expect(redactUrl('/reset-password/abc123secret')).toBe('/reset-password/[redacted]');
    expect(redactUrl('/verify-email/abc123secret?x=1')).toBe('/verify-email/[redacted]?x=1');
  });

  it('leaves the non-token verify-email routes alone', () => {
    expect(redactUrl('/verify-email/pending')).toBe('/verify-email/pending');
    expect(redactUrl('/reset-password')).toBe('/reset-password');
  });

  it('masks _csrf query values wherever they appear', () => {
    expect(redactUrl('/portal/documents?_csrf=tok%7Cen')).toBe('/portal/documents?_csrf=[redacted]');
    expect(redactUrl('/a?x=1&_csrf=secret&y=2')).toBe('/a?x=1&_csrf=[redacted]&y=2');
  });

  it('passes ordinary URLs and undefined through unchanged', () => {
    expect(redactUrl('/portal/documents?page=2')).toBe('/portal/documents?page=2');
    expect(redactUrl(undefined)).toBeUndefined();
  });
});

describe('serializeRequest', () => {
  it('redacts the URL in the serialized request', () => {
    const req = {
      id: 'r1',
      method: 'POST',
      url: '/admin/students/x/documents?_csrf=topsecret',
      headers: {},
      socket: {},
    } as unknown as IncomingMessage;
    const out = serializeRequest(req);
    expect(out.url).toBe('/admin/students/x/documents?_csrf=[redacted]');
    expect(JSON.stringify(out)).not.toContain('topsecret');
  });
});
