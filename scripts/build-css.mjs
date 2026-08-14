/**
 * Minifies public/css/app.css for production.
 *
 * The source file is valid, servable CSS with no build step required — this
 * only strips bytes. Development serves app.css directly, so a broken build
 * script can never block local work.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'lightningcss';

const SOURCE = path.join(process.cwd(), 'public', 'css', 'app.css');
const TARGET = path.join(process.cwd(), 'public', 'css', 'app.min.css');

const source = await fs.readFile(SOURCE);

const { code, warnings } = transform({
  filename: 'app.css',
  code: source,
  minify: true,
  // Matches the browsers a mobile-first African and European audience
  // actually uses (PRD §7).
  targets: {
    chrome: 100 << 16,
    firefox: 100 << 16,
    safari: (15 << 16) | (4 << 8),
    ios_saf: (15 << 16) | (4 << 8),
    android: 100 << 16,
  },
});

for (const warning of warnings) {
  console.warn(`CSS warning: ${warning.message}`);
}

await fs.writeFile(TARGET, code);

const before = source.byteLength;
const after = code.byteLength;
console.log(
  `CSS minified: ${(before / 1024).toFixed(1)} KB → ${(after / 1024).toFixed(1)} KB ` +
    `(${Math.round((1 - after / before) * 100)}% smaller)`,
);
