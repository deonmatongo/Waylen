import { describe, it, expect } from 'vitest';
import {
  paginationQuerySchema,
  profilePatchSchema,
  idParamSchema,
  resourcesQuerySchema,
} from '../../src/validators/api.validator.js';
import { paginate, parse } from '../../src/controllers/api/helpers.js';
import { ValidationError } from '../../src/utils/errors.js';

describe('paginationQuerySchema', () => {
  it('defaults to page 1, 20 per page', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, perPage: 20 });
  });

  it('coerces strings and clamps perPage to 50', () => {
    expect(paginationQuerySchema.parse({ page: '3', perPage: '500' })).toEqual({ page: 3, perPage: 50 });
  });

  it('rejects page 0 and non-numeric input', () => {
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ perPage: 'abc' }).success).toBe(false);
  });
});

describe('paginate', () => {
  const all = Array.from({ length: 45 }, (_, i) => i);

  it('returns the requested slice with the envelope', () => {
    expect(paginate(all, { page: 2, perPage: 20 })).toEqual({
      items: all.slice(20, 40),
      page: 2,
      perPage: 20,
      total: 45,
    });
  });

  it('returns an empty page past the end', () => {
    expect(paginate(all, { page: 9, perPage: 20 }).items).toEqual([]);
  });
});

describe('parse', () => {
  it('throws a ValidationError carrying field errors', () => {
    try {
      parse(idParamSchema, { id: '' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).details).toHaveProperty('id');
    }
  });
});

describe('profilePatchSchema', () => {
  it('accepts a partial update', () => {
    expect(profilePatchSchema.parse({ city: 'Lagos' })).toEqual({ city: 'Lagos' });
  });

  it('strips fields that are not on the allow-list', () => {
    const out = profilePatchSchema.parse({ city: 'Lagos', role: 'ADMIN', email: 'x@y.z', currentStage: 'ENROLLED' });
    expect(out).toEqual({ city: 'Lagos' });
  });

  it('rejects an empty patch', () => {
    expect(profilePatchSchema.safeParse({}).success).toBe(false);
    expect(profilePatchSchema.safeParse({ role: 'ADMIN' }).success).toBe(false);
  });

  it('allows clearing nullable fields', () => {
    expect(profilePatchSchema.parse({ phone: null, preferredStudyLevel: null })).toEqual({
      phone: null,
      preferredStudyLevel: null,
    });
  });

  it('validates the study level and name length', () => {
    expect(profilePatchSchema.safeParse({ preferredStudyLevel: 'PHD' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ fullName: 'A' }).success).toBe(false);
  });
});

describe('resourcesQuerySchema', () => {
  it('rejects an unknown resource type', () => {
    expect(resourcesQuerySchema.safeParse({ type: 'NOPE' }).success).toBe(false);
  });
});
