import { describe, expect, it } from 'vitest';
import { buildPageMeta, parsePage } from '../../src/utils/pagination.js';

describe('parsePage', () => {
  it('defaults to page 1', () => {
    expect(parsePage({}, { perPage: 25 })).toEqual({ page: 1, perPage: 25, skip: 0, take: 25 });
  });
  it('computes skip and clamps garbage', () => {
    expect(parsePage({ page: '3' }, { perPage: 10 }).skip).toBe(20);
    expect(parsePage({ page: '-4' }).page).toBe(1);
    expect(parsePage({ page: 'abc' }).page).toBe(1);
    expect(parsePage({ page: ['2', '5'] }).page).toBe(2);
    expect(parsePage({ page: '99999999' }).page).toBe(10_000);
    expect(parsePage(undefined).page).toBe(1);
  });
  it('clamps perPage', () => {
    expect(parsePage({}, { perPage: 0 }).perPage).toBe(1);
    expect(parsePage({}, { perPage: 5000 }).perPage).toBe(100);
  });
});

describe('buildPageMeta', () => {
  it('handles empty results', () => {
    const m = buildPageMeta({ page: 1, perPage: 20 }, 0);
    expect(m).toMatchObject({ pages: 1, hasPrev: false, hasNext: false, prevPage: null, nextPage: null });
  });
  it('reports neighbours', () => {
    const m = buildPageMeta({ page: 2, perPage: 20 }, 45);
    expect(m).toMatchObject({ pages: 3, totalPages: 3, hasPrev: true, hasNext: true, prevPage: 1, nextPage: 3 });
  });
  it('clamps a page beyond the end', () => {
    const m = buildPageMeta({ page: 9, perPage: 20 }, 45);
    expect(m.page).toBe(3);
    expect(m.hasNext).toBe(false);
  });
});
