import { describe, it, expect } from 'vitest';
import { encryptBuffer, decryptBuffer, sha256, safeCompare } from '../../src/utils/crypto.js';

describe('document encryption', () => {
  it('round-trips a buffer', () => {
    const plaintext = Buffer.from('A student passport scan');
    const { data } = encryptBuffer(plaintext);

    expect(decryptBuffer(data).toString()).toBe('A student passport scan');
  });

  it('produces different ciphertext each time', () => {
    // A fresh IV per call — identical documents must not encrypt identically.
    const plaintext = Buffer.from('identical content');
    const first = encryptBuffer(plaintext);
    const second = encryptBuffer(plaintext);

    expect(first.data.equals(second.data)).toBe(false);
    expect(first.iv).not.toBe(second.iv);
  });

  it('rejects tampered ciphertext', () => {
    // AES-GCM is authenticated, so a flipped byte must fail rather than
    // silently decrypt to garbage (PRD §8.2).
    const { data } = encryptBuffer(Buffer.from('sensitive'));
    const lastIndex = data.length - 1;
    data[lastIndex] = (data[lastIndex] ?? 0) ^ 0xff;

    expect(() => decryptBuffer(data)).toThrow();
  });
});

describe('sha256', () => {
  it('is stable for the same input', () => {
    expect(sha256(Buffer.from('abc'))).toBe(sha256(Buffer.from('abc')));
  });

  it('differs for different input', () => {
    expect(sha256(Buffer.from('abc'))).not.toBe(sha256(Buffer.from('abd')));
  });
});

describe('safeCompare', () => {
  it('matches identical strings', () => {
    expect(safeCompare('signature', 'signature')).toBe(true);
  });

  it('rejects different strings', () => {
    expect(safeCompare('signature', 'signatura')).toBe(false);
  });

  it('rejects different lengths without throwing', () => {
    expect(safeCompare('short', 'much longer value')).toBe(false);
  });
});
