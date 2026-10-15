/**
 * RFC 6238 TOTP (SHA-1, 30s step, 6 digits) implemented over node:crypto, so
 * there is no extra dependency. Pure functions only; no I/O.
 */
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accepted drift, in steps either side of "now". */
export const TOTP_WINDOW = 1;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160-bit random secret, base32 encoded (the form authenticator apps take). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const offset = (h[h.length - 1] as number) & 0x0f;
  const bin =
    (((h[offset] as number) & 0x7f) << 24) |
    (((h[offset + 1] as number) & 0xff) << 16) |
    (((h[offset + 2] as number) & 0xff) << 8) |
    ((h[offset + 3] as number) & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpCounter(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

export function generateTotp(
  base32Secret: string,
  nowMs: number = Date.now(),
  digits = TOTP_DIGITS,
): string {
  return hotp(base32Decode(base32Secret), totpCounter(nowMs), digits);
}

/**
 * Checks `code` against the counters within the window. Returns the matching
 * counter, or null. Counters <= `lastUsedCounter` are rejected (replay
 * protection: a code may be accepted once, and never an older one after a
 * newer one). Every candidate is compared in constant time.
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  opts: { nowMs?: number; lastUsedCounter?: number | null; window?: number } = {},
): number | null {
  const normalised = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalised)) return null;

  const secret = base32Decode(base32Secret);
  const now = totpCounter(opts.nowMs);
  const window = opts.window ?? TOTP_WINDOW;
  const given = Buffer.from(normalised);
  let matched: number | null = null;

  for (let c = now - window; c <= now + window; c++) {
    const expected = Buffer.from(hotp(secret, c));
    if (crypto.timingSafeEqual(expected, given)) {
      if (opts.lastUsedCounter != null && c <= opts.lastUsedCounter) continue;
      matched = c;
    }
  }
  return matched;
}

export function otpauthUri(opts: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
