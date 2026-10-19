/**
 * IP-aware sign-in throttle. The per-account lockout in auth.service.ts
 * counts failures against the *account*, so on its own anyone can lock a
 * victim out by guessing their password. This sits in front of it: once an
 * IP (or an IP+email pair) has failed too often, further attempts are refused
 * with the generic invalid-credentials message and never reach the account
 * counter, so one IP cannot lock out many accounts.
 *
 * Counting is optimistic: every attempt takes a hit, and a success gives it
 * back, so legitimate users are not penalised (same idea as
 * `skipSuccessfulRequests` on the express-rate-limit login limiter).
 */
import crypto from 'node:crypto';
import { createCounterStore, type CounterStore } from '../middleware/rateLimit.js';

const WINDOW_MS = 15 * 60_000;
/** Attempts per IP + email per window. Below the account lockout threshold. */
export const PAIR_LIMIT = 5;
/** Attempts per IP per window, across all emails. */
export const IP_LIMIT = 30;

export interface Counters {
  pair: CounterStore;
  ip: CounterStore;
}

let counters: Counters | undefined;
function getCounters(): Counters {
  counters ??= {
    pair: createCounterStore('login:pair:', WINDOW_MS),
    ip: createCounterStore('login:ip:', WINDOW_MS),
  };
  return counters;
}

/** Test seam: swap the stores. */
export function setLoginThrottleCounters(next: Counters | undefined): void {
  counters = next;
}

function pairKey(ip: string, email: string): string {
  const digest = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `${ip}:${digest}`;
}

export const loginThrottle = {
  /**
   * Records an attempt. Returns true when it is over budget and must be
   * refused without touching the account. Fails open if the store errors —
   * the account lockout still applies.
   */
  async attempt(ip: string, email: string): Promise<boolean> {
    try {
      const c = getCounters();
      const [pair, ipHits] = await Promise.all([c.pair.hit(pairKey(ip, email)), c.ip.hit(ip)]);
      return pair > PAIR_LIMIT || ipHits > IP_LIMIT;
    } catch {
      return false;
    }
  },

  /** A successful sign-in clears the pair and gives back the IP hit. */
  async succeeded(ip: string, email: string): Promise<void> {
    try {
      const c = getCounters();
      await Promise.all([c.pair.reset(pairKey(ip, email)), c.ip.unhit(ip)]);
    } catch {
      /* best effort */
    }
  },
};
