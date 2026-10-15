/**
 * Allow-list HTML sanitiser for CMS rich text.
 *
 * Staff-authored fields (opportunity/country/webinar descriptions, resource
 * bodies, FAQ answers) are rendered unescaped with `<%- %>`, so anything an
 * editor — or a compromised editor account — pastes in must be reduced to a
 * small set of presentational tags before it is stored.
 */
import sanitizeHtml from 'sanitize-html';

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a',
    'h2', 'h3', 'h4', 'blockquote', 'img',
  ],
  allowedAttributes: {
    a: ['href', 'rel'],
    img: ['src', 'alt'],
  },
  allowedSchemes: ['https', 'mailto'],
  // Per-tag so an `<a href="http://…">` is stripped but `img src` is https only.
  allowedSchemesByTag: { a: ['https', 'mailto'], img: ['https'] },
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
  // Drop the contents of script/style rather than leaking their text.
  disallowedTagsMode: 'discard',
};

/** Reduces untrusted HTML to the allow-list above. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
