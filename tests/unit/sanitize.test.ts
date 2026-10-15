import { describe, it, expect } from 'vitest';
import { sanitizeRichText } from '../../src/utils/sanitize.js';

describe('sanitizeRichText', () => {
  it('keeps allow-listed formatting', () => {
    const html = '<h2>Title</h2><p>Hello <strong>there</strong><br><em>you</em></p><ul><li>One</li></ul>';
    expect(sanitizeRichText(html)).toBe(html.replace('<br>', '<br />'));
  });

  it('strips script, style and event handlers', () => {
    const out = sanitizeRichText('<p onclick="x()">Hi</p><script>alert(1)</script><style>p{}</style>');
    expect(out).toBe('<p>Hi</p>');
  });

  it('removes javascript: and data: hrefs but keeps https and mailto', () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
    expect(sanitizeRichText('<a href="data:text/html,hi">x</a>')).not.toContain('data:');
    expect(sanitizeRichText('<a href="http://example.com">x</a>')).not.toContain('href');
    expect(sanitizeRichText('<a href="https://example.com">x</a>')).toContain('href="https://example.com"');
    expect(sanitizeRichText('<a href="mailto:a@b.co">x</a>')).toContain('href="mailto:a@b.co"');
  });

  it('forces rel=noopener on links, overriding any supplied rel', () => {
    const out = sanitizeRichText('<a href="https://example.com" rel="opener">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain('rel="opener"');
  });

  it('allows https images only', () => {
    expect(sanitizeRichText('<img src="https://cdn.example.com/a.png" alt="a">')).toContain('src="https://cdn.example.com/a.png"');
    expect(sanitizeRichText('<img src="http://example.com/a.png">')).not.toContain('src');
    expect(sanitizeRichText('<img src="javascript:alert(1)">')).not.toContain('javascript');
    expect(sanitizeRichText('<img src="//evil.example/a.png">')).not.toContain('src');
  });

  it('drops disallowed tags and attributes such as style and class', () => {
    expect(sanitizeRichText('<div class="a" style="color:red"><iframe src="https://x.co"></iframe>ok</div>')).toBe('ok');
  });
});
