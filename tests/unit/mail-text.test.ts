import { describe, it, expect } from 'vitest';
import { htmlToText } from '../../src/services/mail.service.js';

describe('htmlToText', () => {
  it('renders links as text (url)', () => {
    expect(htmlToText('<p>Go <a href="https://x.io/a?b=1&amp;c=2">here</a> now</p>')).toBe('Go here (https://x.io/a?b=1&c=2) now');
  });
  it('does not duplicate a link whose label is the url', () => {
    expect(htmlToText('<a href="https://x.io">https://x.io</a>')).toBe('https://x.io');
  });
  it('turns headings, paragraphs, lists and br into newlines', () => {
    const out = htmlToText('<h1>Hi</h1><p>One<br>Two</p><ul><li>A</li><li>B</li></ul>');
    expect(out).toBe('Hi\n\nOne\nTwo\n\n- A\n\n- B');
  });
  it('drops style/head and decodes entities', () => {
    expect(htmlToText('<head><title>t</title></head><style>p{}</style><p>Tom &amp; Jerry&nbsp;&#169; &#x41;</p>')).toBe('Tom & Jerry © A');
  });
});
