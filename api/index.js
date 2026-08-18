// Vercel Functions must live under /api to be auto-detected — this is a thin
// re-export so the real bootstrap logic stays in one place (src/server.ts,
// compiled to dist/server.js by the normal build).
export { default } from '../dist/server.js';
