import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema } from '../../src/validators/auth.validator.js';
import { contactSchema } from '../../src/validators/contact.validator.js';

const validRegistration = {
  fullName: 'Tariro Nyathi',
  email: 'Tariro@Example.COM',
  password: 'StrongPass123',
  passwordConfirmation: 'StrongPass123',
  acceptTerms: 'on',
};

describe('registerSchema', () => {
  it('accepts a valid registration and normalises the email', () => {
    const result = registerSchema.safeParse(validRegistration);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('tariro@example.com');
  });

  it('rejects mismatched passwords', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      passwordConfirmation: 'DifferentPass123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password without an uppercase letter', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      password: 'weakpassword123',
      passwordConfirmation: 'weakpassword123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password under 10 characters', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      password: 'Short1',
      passwordConfirmation: 'Short1',
    });
    expect(result.success).toBe(false);
  });

  it('requires the terms checkbox', () => {
    const { acceptTerms: _omitted, ...withoutTerms } = validRegistration;
    expect(registerSchema.safeParse(withoutTerms).success).toBe(false);
  });

  it('coerces a single checkbox value into an array', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      preferredDestinations: 'poland',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.preferredDestinations).toEqual(['poland']);
  });
});

describe('loginSchema', () => {
  it('rejects a malformed email', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });
});

describe('contactSchema', () => {
  it('rejects a message that is too short to act on', () => {
    const result = contactSchema.safeParse({
      fullName: 'Nomsa Dube',
      email: 'nomsa@example.com',
      message: 'hi',
    });
    expect(result.success).toBe(false);
  });
});
