import { describe, it, expect } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotp,
  hotp,
  otpauthUri,
  verifyTotp,
} from '../../src/utils/totp.js';
import {
  checkCode,
  consumeRecoveryCode,
  generateRecoveryCodes,
  openBlob,
  sealBlob,
  type MfaBlob,
} from '../../src/utils/mfaBlob.js';
import { MFA_PENDING_TTL_MS, newNonce, signPending, verifyPending } from '../../src/utils/mfaPending.js';

// RFC 6238 appendix B, SHA-1 seed "12345678901234567890", 8 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    for (const [t, expected] of VECTORS) {
      expect(generateTotp(RFC_SECRET, t * 1000, 8)).toBe(expected);
    }
  });

  it('round-trips base32', () => {
    const buf = Buffer.from([1, 2, 3, 250, 251, 252, 0, 9]);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('accepts +-1 step and rejects +-2', () => {
    const now = 1_700_000_000_000;
    const at = (offset: number) => generateTotp(RFC_SECRET, now + offset * 30_000);
    expect(verifyTotp(RFC_SECRET, at(0), { nowMs: now })).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, at(-1), { nowMs: now })).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, at(1), { nowMs: now })).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, at(2), { nowMs: now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, at(-2), { nowMs: now })).toBeNull();
  });

  it('rejects malformed codes', () => {
    expect(verifyTotp(RFC_SECRET, 'abcdef')).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345')).toBeNull();
  });

  it('rejects replays of a used counter or an older one', () => {
    const now = 1_700_000_000_000;
    const code = generateTotp(RFC_SECRET, now);
    const counter = verifyTotp(RFC_SECRET, code, { nowMs: now });
    expect(counter).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now, lastUsedCounter: counter })).toBeNull();
    const older = generateTotp(RFC_SECRET, now - 30_000);
    expect(verifyTotp(RFC_SECRET, older, { nowMs: now, lastUsedCounter: counter })).toBeNull();
  });

  it('builds an otpauth URI', () => {
    const uri = otpauthUri({ secret: 'ABC', account: 'a@b.co', issuer: 'Way len' });
    expect(uri.startsWith('otpauth://totp/Way%20len:a%40b.co?')).toBe(true);
    expect(uri).toContain('secret=ABC');
    expect(hotp(Buffer.from('12345678901234567890'), 0)).toBe('755224');
  });
});

describe('MFA blob', () => {
  const base = (): MfaBlob => ({ secret: RFC_SECRET, recoveryHashes: [], lastCounter: null });

  it('encrypts and decrypts, and does not leak the secret', () => {
    const sealed = sealBlob({ ...base(), recoveryHashes: ['h'] });
    expect(sealed).not.toContain(RFC_SECRET);
    expect(Buffer.from(sealed, 'base64').toString('latin1')).not.toContain(RFC_SECRET);
    expect(openBlob(sealed)?.secret).toBe(RFC_SECRET);
  });

  it('returns null for tampered or empty input', () => {
    const sealed = Buffer.from(sealBlob(base()), 'base64');
    sealed[sealed.length - 1] = (sealed[sealed.length - 1] ?? 0) ^ 0xff;
    expect(openBlob(sealed.toString('base64'))).toBeNull();
    expect(openBlob(null)).toBeNull();
  });

  it('generates 10 unique codes and consumes each once', () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    const blob = { ...base(), recoveryHashes: hashes };
    const after = consumeRecoveryCode(blob, codes[3]!.toUpperCase());
    expect(after?.recoveryHashes).toHaveLength(9);
    expect(consumeRecoveryCode(after!, codes[3]!)).toBeNull();
    expect(consumeRecoveryCode(blob, 'nope-nope1')).toBeNull();
  });

  it('checkCode accepts totp once, then a recovery code', () => {
    const now = Date.now();
    const { codes, hashes } = generateRecoveryCodes();
    const blob = { ...base(), recoveryHashes: hashes };
    const code = generateTotp(RFC_SECRET, now);
    const first = checkCode(blob, code, now);
    expect(first.ok && first.kind).toBe('totp');
    if (!first.ok) throw new Error('unreachable');
    expect(checkCode(first.blob, code, now).ok).toBe(false);
    const rec = checkCode(first.blob, codes[0]!, now);
    expect(rec.ok && rec.kind).toBe('recovery');
  });
});

describe('pending MFA cookie', () => {
  const p = () => ({ userId: 'u1', expiresAt: Date.now() + MFA_PENDING_TTL_MS, nonce: newNonce() });

  it('verifies a signed value', () => {
    const v = p();
    expect(verifyPending(signPending(v))).toEqual(v);
  });

  it('rejects tampering, expiry and garbage', () => {
    const v = p();
    const signed = signPending(v);
    const [payload, sig] = signed.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ u: 'admin', e: v.expiresAt, n: v.nonce })).toString('base64url');
    expect(verifyPending(`${forged}.${sig}`)).toBeNull();
    expect(verifyPending(`${payload}.x${sig}`)).toBeNull();
    expect(verifyPending(signed, v.expiresAt + 1)).toBeNull();
    expect(verifyPending(undefined)).toBeNull();
    expect(verifyPending('garbage')).toBeNull();
  });
});
