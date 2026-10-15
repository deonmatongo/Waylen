import { describe, it, expect } from 'vitest';
import { webinarSchema } from '../../src/validators/webinar.validator.js';
import { resourceSchema } from '../../src/validators/resource.validator.js';
import { partnerSchema } from '../../src/validators/partner.validator.js';
import { faqSchema } from '../../src/validators/content.validator.js';

const webinar = {
  title: 'Visa basics',
  status: 'DRAFT',
  format: 'ONLINE',
  startsAt: '2030-01-01T10:00',
  endsAt: '2030-01-01T11:00',
};
const resource = { title: 'Guide', type: 'ARTICLE', status: 'DRAFT' };
const partner = { name: 'Acme Uni', category: 'INSTITUTION', status: 'ACTIVE' };

const bad = ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/x', 'not a url', '//evil.example'];

describe('webinar URLs', () => {
  it('accepts http(s) join and recording URLs and blanks', () => {
    const r = webinarSchema.safeParse({ ...webinar, joinUrl: 'https://zoom.us/j/1', recordingUrl: '' });
    expect(r.success).toBe(true);
  });
  it.each(bad)('rejects %s', (value) => {
    expect(webinarSchema.safeParse({ ...webinar, joinUrl: value }).success).toBe(false);
    expect(webinarSchema.safeParse({ ...webinar, recordingUrl: value }).success).toBe(false);
  });
  it('sanitises the description', () => {
    const r = webinarSchema.safeParse({ ...webinar, description: '<p>Hi</p><script>x()</script>' });
    expect(r.success && r.data.description).toBe('<p>Hi</p>');
  });
});

describe('resource URLs', () => {
  it('accepts http(s) externalUrl and site-relative or http(s) filePath', () => {
    expect(resourceSchema.safeParse({ ...resource, externalUrl: 'https://youtu.be/x' }).success).toBe(true);
    expect(resourceSchema.safeParse({ ...resource, filePath: '/uploads/guide.pdf' }).success).toBe(true);
    expect(resourceSchema.safeParse({ ...resource, filePath: 'https://cdn.example.com/g.pdf' }).success).toBe(true);
  });
  it.each(bad)('rejects %s as externalUrl and filePath', (value) => {
    expect(resourceSchema.safeParse({ ...resource, externalUrl: value }).success).toBe(false);
    expect(resourceSchema.safeParse({ ...resource, filePath: value }).success).toBe(false);
  });
  it('sanitises the body', () => {
    const r = resourceSchema.safeParse({ ...resource, body: '<p onclick="x()">Hi</p>' });
    expect(r.success && r.data.body).toBe('<p>Hi</p>');
  });
});

describe('partner websiteUrl', () => {
  it('accepts http(s)', () => {
    expect(partnerSchema.safeParse({ ...partner, websiteUrl: 'https://acme.edu' }).success).toBe(true);
  });
  it.each(bad)('rejects %s', (value) => {
    expect(partnerSchema.safeParse({ ...partner, websiteUrl: value }).success).toBe(false);
  });
});

describe('faqSchema', () => {
  it('sanitises the answer', () => {
    const r = faqSchema.safeParse({
      question: 'Do I need a visa?',
      answer: '<p>Yes</p><script>x()</script>',
      topic: 'Visas',
      status: 'PUBLISHED',
    });
    expect(r.success && r.data.answer).toBe('<p>Yes</p>');
    expect(r.success && r.data.topic).toBe('visas');
  });
});
