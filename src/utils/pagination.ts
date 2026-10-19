/**
 * Shared list pagination. `parsePage` clamps untrusted query input; `buildPageMeta`
 * shapes the result for views/partials/pagination.ejs (which reads `page` and
 * `totalPages`; the other fields are for custom controls).
 */

export const DEFAULT_PER_PAGE = 20;
export const MAX_PAGE = 10_000;

export interface PageRequest {
  page: number;
  perPage: number;
  skip: number;
  take: number;
}

export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
  pages: number;
  /** Alias of `pages`, matching the existing pagination partial. */
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  prevPage: number | null;
  nextPage: number | null;
}

function toInt(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? n : undefined;
}

export function parsePage(
  query: Record<string, unknown> | undefined,
  options: { perPage?: number; maxPerPage?: number } = {},
): PageRequest {
  const perPage = Math.min(Math.max(1, Math.floor(options.perPage ?? DEFAULT_PER_PAGE)), options.maxPerPage ?? 100);
  const page = Math.min(Math.max(1, toInt(query?.page) ?? 1), MAX_PAGE);
  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

export function buildPageMeta(req: Pick<PageRequest, 'page' | 'perPage'>, total: number): PageMeta {
  const safeTotal = Math.max(0, Math.floor(total) || 0);
  const pages = Math.max(1, Math.ceil(safeTotal / req.perPage));
  const page = Math.min(req.page, pages);
  return {
    page,
    perPage: req.perPage,
    total: safeTotal,
    pages,
    totalPages: pages,
    hasPrev: page > 1,
    hasNext: page < pages,
    prevPage: page > 1 ? page - 1 : null,
    nextPage: page < pages ? page + 1 : null,
  };
}
