/**
 * End-to-end auth flow coverage: sign up, sign in, email verification,
 * forgot/reset password, change password, logout, and the session/JWT
 * invalidation a password change must trigger.
 *
 * Needs a real database — see tests/integration/README.md. Every user this
 * file creates uses the `+auth-audit-<run>@` local-part convention below so
 * afterAll can clean up precisely, never with a broad DELETE.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';

let app: Express;
let prisma: PrismaClient;

const RUN_ID = `auth-audit-${Date.now()}`;
const emailFor = (label: string) => `${RUN_ID}-${label}@example.com`;
const STRONG_PASSWORD = 'Str0ngPassw0rd!';
const OTHER_STRONG_PASSWORD = 'An0therStrong!';

interface Agent {
  /** Already joined as a single `Cookie:` header value ("a=1; b=2"). */
  cookies: string;
  csrfToken: string;
}

function toPairs(cookieHeader: string): Map<string, string> {
  if (!cookieHeader) return new Map();
  return new Map(
    cookieHeader
      .split('; ')
      .filter(Boolean)
      .map((pair) => [pair.split('=')[0]!, pair]),
  );
}

function fromPairs(pairs: Map<string, string>): string {
  return [...pairs.values()].join('; ');
}

/** Pulls the `_csrf` hidden field out of a rendered page, or throws. */
function extractCsrfToken(html: string): string {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) throw new Error('No CSRF token found on page');
  return match[1]!;
}

/** GETs a form page and captures its CSRF cookie/token pair. */
async function primeCsrf(path: string): Promise<Agent> {
  const res = await request(app).get(path);
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const pairs = toPairs('');
  for (const raw of setCookie ?? []) {
    const pair = raw.split(';')[0]!;
    pairs.set(pair.split('=')[0]!, pair);
  }
  return { cookies: fromPairs(pairs), csrfToken: extractCsrfToken(res.text) };
}

/** Merges new Set-Cookie headers from a response into an existing cookie jar. */
function mergeCookies(existing: string, res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  if (!setCookie) return existing;
  const pairs = toPairs(existing);
  for (const raw of setCookie) {
    const pair = raw.split(';')[0]!;
    pairs.set(pair.split('=')[0]!, pair);
  }
  return fromPairs(pairs);
}

beforeAll(async () => {
  const appModule = await import('../../src/app.js');
  const dbModule = await import('../../src/config/database.js');
  app = appModule.createApp();
  prisma = dbModule.prisma;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN_ID } } });
  await prisma.$disconnect();
});

describe('sign up', () => {
  it('rejects a weak password server-side', async () => {
    const { cookies, csrfToken } = await primeCsrf('/register');
    const res = await request(app)
      .post('/register')
      .set('Cookie', cookies)
      .type('form')
      .send({
        fullName: 'Weak Password',
        email: emailFor('weak'),
        password: 'weakpass',
        passwordConfirmation: 'weakpass',
        acceptTerms: 'on',
        _csrf: csrfToken,
      });

    expect(res.status).toBe(422);
    const exists = await prisma.user.findUnique({ where: { email: emailFor('weak') } });
    expect(exists).toBeNull();
  });

  it('registers a new student, hashes the password, and emails a verification link', async () => {
    const email = emailFor('signup');
    const { cookies, csrfToken } = await primeCsrf('/register');

    const res = await request(app)
      .post('/register')
      .set('Cookie', cookies)
      .type('form')
      .send({
        fullName: 'New Student',
        email,
        password: STRONG_PASSWORD,
        passwordConfirmation: STRONG_PASSWORD,
        acceptTerms: 'on',
        _csrf: csrfToken,
      });

    // 303, not 302 — safeRedirect.ts upgrades POST-triggered redirects to
    // See Other so Vercel's edge never replays the POST (see that file).
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/verify-email/pending');

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    expect(user!.status).toBe('PENDING_VERIFICATION');
    expect(user!.emailVerifiedAt).toBeNull();
    // Never plaintext, never a fast/weak hash — argon2id hashes start with $argon2id$.
    expect(user!.passwordHash).not.toBe(STRONG_PASSWORD);
    expect(user!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(user!.verificationToken).not.toBeNull();
    expect(user!.verificationExpiresAt).not.toBeNull();
  });

  it('rejects a duplicate email with a 409, without overwriting the original account', async () => {
    const email = emailFor('dup');
    const { cookies, csrfToken } = await primeCsrf('/register');
    await request(app)
      .post('/register')
      .set('Cookie', cookies)
      .type('form')
      .send({
        fullName: 'Original',
        email,
        password: STRONG_PASSWORD,
        passwordConfirmation: STRONG_PASSWORD,
        acceptTerms: 'on',
        _csrf: csrfToken,
      });

    const second = await primeCsrf('/register');
    const res = await request(app)
      .post('/register')
      .set('Cookie', second.cookies)
      .type('form')
      .send({
        fullName: 'Impersonator',
        email,
        password: OTHER_STRONG_PASSWORD,
        passwordConfirmation: OTHER_STRONG_PASSWORD,
        acceptTerms: 'on',
        _csrf: second.csrfToken,
      });

    expect(res.status).toBe(409);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.fullName).toBe('Original');
  });
});

describe('email verification', () => {
  it('activates the account via a valid token and blocks portal access beforehand', async () => {
    const email = emailFor('verify');
    const { cookies, csrfToken } = await primeCsrf('/register');
    await request(app)
      .post('/register')
      .set('Cookie', cookies)
      .type('form')
      .send({
        fullName: 'Verify Me',
        email,
        password: STRONG_PASSWORD,
        passwordConfirmation: STRONG_PASSWORD,
        acceptTerms: 'on',
        _csrf: csrfToken,
      });

    const unverified = await prisma.user.findUniqueOrThrow({ where: { email } });

    const verifyRes = await request(app).get(`/verify-email/${unverified.verificationToken}`);
    expect(verifyRes.status).toBe(302);
    expect(verifyRes.headers.location).toBe('/portal');

    const verified = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(verified.emailVerifiedAt).not.toBeNull();
    expect(verified.status).toBe('ACTIVE');
    // Single-use.
    expect(verified.verificationToken).toBeNull();

    const reuse = await request(app).get(`/verify-email/${unverified.verificationToken}`);
    expect(reuse.status).toBe(422);
  });

  it('rejects an unknown/invalid token', async () => {
    const res = await request(app).get('/verify-email/not-a-real-token');
    expect(res.status).toBe(422);
  });
});

describe('sign in', () => {
  async function registerAndVerify(label: string, password = STRONG_PASSWORD) {
    const email = emailFor(label);
    const { cookies, csrfToken } = await primeCsrf('/register');
    await request(app)
      .post('/register')
      .set('Cookie', cookies)
      .type('form')
      .send({
        fullName: 'Sign In Fixture',
        email,
        password,
        passwordConfirmation: password,
        acceptTerms: 'on',
        _csrf: csrfToken,
      });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
    return email;
  }

  it('logs in with correct credentials and reaches the portal', async () => {
    const email = await registerAndVerify('login-ok');
    const { cookies, csrfToken } = await primeCsrf('/login');

    const res = await request(app)
      .post('/login')
      .set('Cookie', cookies)
      .type('form')
      .send({ email, password: STRONG_PASSWORD, _csrf: csrfToken });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/portal');
    const sessionCookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('waylen.sid='),
    );
    expect(sessionCookie).toBeDefined();
    // httpOnly session cookie, never readable from client JS.
    expect(sessionCookie!.toLowerCase()).toContain('httponly');
  });

  it('gives the same generic error for a wrong password and for an unknown email', async () => {
    const email = await registerAndVerify('login-generic');

    const wrongPassReq = await primeCsrf('/login');
    const wrongPass = await request(app)
      .post('/login')
      .set('Cookie', wrongPassReq.cookies)
      .type('form')
      .send({ email, password: 'TotallyWrong1', _csrf: wrongPassReq.csrfToken });

    const unknownEmailReq = await primeCsrf('/login');
    const unknownEmail = await request(app)
      .post('/login')
      .set('Cookie', unknownEmailReq.cookies)
      .type('form')
      .send({ email: emailFor('does-not-exist'), password: 'TotallyWrong1', _csrf: unknownEmailReq.csrfToken });

    expect(wrongPass.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const wrongPassMessage = wrongPass.text.match(/field-error--form"[^>]*>([^<]+)</)?.[1];
    const unknownEmailMessage = unknownEmail.text.match(/field-error--form"[^>]*>([^<]+)</)?.[1];
    expect(wrongPassMessage).toBe(unknownEmailMessage);
  });

  it('locks the account out after repeated failures', async () => {
    const email = await registerAndVerify('login-lockout');

    for (let i = 0; i < 8; i++) {
      const { cookies, csrfToken } = await primeCsrf('/login');
      await request(app)
        .post('/login')
        .set('Cookie', cookies)
        .type('form')
        .send({ email, password: 'WrongPassword1', _csrf: csrfToken });
    }

    const { cookies, csrfToken } = await primeCsrf('/login');
    const res = await request(app)
      .post('/login')
      .set('Cookie', cookies)
      .type('form')
      .send({ email, password: STRONG_PASSWORD, _csrf: csrfToken });

    expect(res.status).toBe(401);
    expect(res.text).toMatch(/too many failed attempts/i);
    // 9 sequential logins, each an Argon2 verify plus a round trip to a
    // remote database, comfortably exceed the 5s default test timeout.
  }, 30_000);
});

describe('forgot / reset password', () => {
  async function registerAndVerify(label: string) {
    const email = emailFor(label);
    const { cookies, csrfToken } = await primeCsrf('/register');
    await request(app)
      .post('/register')
      .set('Cookie', cookies)
      .type('form')
      .send({
        fullName: 'Reset Fixture',
        email,
        password: STRONG_PASSWORD,
        passwordConfirmation: STRONG_PASSWORD,
        acceptTerms: 'on',
        _csrf: csrfToken,
      });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
    return email;
  }

  it('gives an identical response for a known and an unknown email', async () => {
    const email = await registerAndVerify('forgot-generic');

    const known = await primeCsrf('/forgot-password');
    const knownRes = await request(app)
      .post('/forgot-password')
      .set('Cookie', known.cookies)
      .type('form')
      .send({ email, _csrf: known.csrfToken });

    const unknown = await primeCsrf('/forgot-password');
    const unknownRes = await request(app)
      .post('/forgot-password')
      .set('Cookie', unknown.cookies)
      .type('form')
      .send({ email: emailFor('ghost'), _csrf: unknown.csrfToken });

    expect(knownRes.status).toBe(200);
    expect(unknownRes.status).toBe(200);
    expect(knownRes.text).toContain('Check your email');
    expect(unknownRes.text).toContain('Check your email');
  });

  it('resets the password, invalidates the old session, and makes the old token single-use', async () => {
    const email = await registerAndVerify('reset-flow');

    // Establish a logged-in session BEFORE the reset — this is the session
    // that must stop working once the password changes.
    const loginForm = await primeCsrf('/login');
    const loginRes = await request(app)
      .post('/login')
      .set('Cookie', loginForm.cookies)
      .type('form')
      .send({ email, password: STRONG_PASSWORD, _csrf: loginForm.csrfToken });
    const staleCookies = mergeCookies(loginForm.cookies, loginRes);

    const preResetCheck = await request(app).get('/portal').set('Cookie', staleCookies);
    expect(preResetCheck.status).toBe(200);

    const forgot = await primeCsrf('/forgot-password');
    await request(app)
      .post('/forgot-password')
      .set('Cookie', forgot.cookies)
      .type('form')
      .send({ email, _csrf: forgot.csrfToken });

    const withToken = await prisma.user.findUniqueOrThrow({ where: { email } });
    const resetToken = withToken.passwordResetToken;
    expect(resetToken).not.toBeNull();

    const resetForm = await primeCsrf(`/reset-password/${resetToken}`);
    const resetRes = await request(app)
      .post(`/reset-password/${resetToken}`)
      .set('Cookie', resetForm.cookies)
      .type('form')
      .send({
        password: OTHER_STRONG_PASSWORD,
        passwordConfirmation: OTHER_STRONG_PASSWORD,
        _csrf: resetForm.csrfToken,
      });
    expect(resetRes.status).toBe(303);
    expect(resetRes.headers.location).toBe('/login');

    const afterReset = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(afterReset.passwordResetToken).toBeNull();
    expect(afterReset.passwordHash).not.toBe(withToken.passwordHash);
    expect(afterReset.passwordChangedAt).not.toBeNull();

    // The session cookie issued before the reset must now be rejected.
    const staleAccess = await request(app).get('/portal').set('Cookie', staleCookies);
    expect(staleAccess.status).toBe(302);
    expect(staleAccess.headers.location).toBe('/login');

    // The old password no longer works; the new one does.
    const oldPassAttempt = await primeCsrf('/login');
    const oldPassRes = await request(app)
      .post('/login')
      .set('Cookie', oldPassAttempt.cookies)
      .type('form')
      .send({ email, password: STRONG_PASSWORD, _csrf: oldPassAttempt.csrfToken });
    expect(oldPassRes.status).toBe(401);

    const newPassAttempt = await primeCsrf('/login');
    const newPassRes = await request(app)
      .post('/login')
      .set('Cookie', newPassAttempt.cookies)
      .type('form')
      .send({ email, password: OTHER_STRONG_PASSWORD, _csrf: newPassAttempt.csrfToken });
    expect(newPassRes.status).toBe(303);
    expect(newPassRes.headers.location).toBe('/portal');

    // The consumed reset token cannot be replayed.
    const replayForm = await primeCsrf(`/reset-password/${resetToken}`);
    const replay = await request(app)
      .post(`/reset-password/${resetToken}`)
      .set('Cookie', replayForm.cookies)
      .type('form')
      .send({
        password: 'YetAnotherStrong1!',
        passwordConfirmation: 'YetAnotherStrong1!',
        _csrf: replayForm.csrfToken,
      });
    expect(replay.status).toBe(422);
  }, 30_000);

  it('rejects an expired reset token', async () => {
    const email = await registerAndVerify('reset-expired');
    const forgot = await primeCsrf('/forgot-password');
    await request(app)
      .post('/forgot-password')
      .set('Cookie', forgot.cookies)
      .type('form')
      .send({ email, _csrf: forgot.csrfToken });

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetExpiresAt: new Date(Date.now() - 1000) },
    });

    const resetForm = await primeCsrf(`/reset-password/${user.passwordResetToken}`);
    const res = await request(app)
      .post(`/reset-password/${user.passwordResetToken}`)
      .set('Cookie', resetForm.cookies)
      .type('form')
      .send({
        password: OTHER_STRONG_PASSWORD,
        passwordConfirmation: OTHER_STRONG_PASSWORD,
        _csrf: resetForm.csrfToken,
      });
    expect(res.status).toBe(422);
    expect(res.text).toMatch(/expired/i);
  });
});

describe('change password while logged in', () => {
  async function loginAsNewStudent(label: string) {
    const email = emailFor(label);
    const { cookies, csrfToken } = await primeCsrf('/register');
    await request(app)
      .post('/register')
      .set('Cookie', cookies)
      .type('form')
      .send({
        fullName: 'Change Password Fixture',
        email,
        password: STRONG_PASSWORD,
        passwordConfirmation: STRONG_PASSWORD,
        acceptTerms: 'on',
        _csrf: csrfToken,
      });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });

    const loginForm = await primeCsrf('/login');
    const loginRes = await request(app)
      .post('/login')
      .set('Cookie', loginForm.cookies)
      .type('form')
      .send({ email, password: STRONG_PASSWORD, _csrf: loginForm.csrfToken });
    return { email, cookies: mergeCookies(loginForm.cookies, loginRes) };
  }

  it('rejects the wrong current password', async () => {
    const { cookies } = await loginAsNewStudent('change-wrong-current');
    const settingsPage = await request(app).get('/portal/settings').set('Cookie', cookies);
    const token = extractCsrfToken(settingsPage.text);

    const res = await request(app)
      .post('/portal/settings/password')
      .set('Cookie', cookies)
      .type('form')
      .send({
        currentPassword: 'NotTheRealPassword1',
        password: OTHER_STRONG_PASSWORD,
        passwordConfirmation: OTHER_STRONG_PASSWORD,
        _csrf: token,
      });

    expect(res.status).toBe(422);
  });

  it('changes the password and invalidates other sessions', async () => {
    const { email, cookies: deviceA } = await loginAsNewStudent('change-ok');

    // A second "device" logs in with the same (still current) password.
    const loginFormB = await primeCsrf('/login');
    const loginResB = await request(app)
      .post('/login')
      .set('Cookie', loginFormB.cookies)
      .type('form')
      .send({ email, password: STRONG_PASSWORD, _csrf: loginFormB.csrfToken });
    const deviceB = mergeCookies(loginFormB.cookies, loginResB);

    const settingsPage = await request(app).get('/portal/settings').set('Cookie', deviceA);
    const token = extractCsrfToken(settingsPage.text);

    const changeRes = await request(app)
      .post('/portal/settings/password')
      .set('Cookie', deviceA)
      .type('form')
      .send({
        currentPassword: STRONG_PASSWORD,
        password: OTHER_STRONG_PASSWORD,
        passwordConfirmation: OTHER_STRONG_PASSWORD,
        _csrf: token,
      });
    expect(changeRes.status).toBe(303);

    // Device B's session, established before the change, is now rejected.
    const deviceBAfter = await request(app).get('/portal').set('Cookie', deviceB);
    expect(deviceBAfter.status).toBe(302);
    expect(deviceBAfter.headers.location).toBe('/login');
  }, 30_000);
});

describe('logout', () => {
  it('clears the session so the portal is no longer reachable', async () => {
    const email = emailFor('logout');
    const { cookies, csrfToken } = await primeCsrf('/register');
    await request(app)
      .post('/register')
      .set('Cookie', cookies)
      .type('form')
      .send({
        fullName: 'Logout Fixture',
        email,
        password: STRONG_PASSWORD,
        passwordConfirmation: STRONG_PASSWORD,
        acceptTerms: 'on',
        _csrf: csrfToken,
      });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });

    const loginForm = await primeCsrf('/login');
    const loginRes = await request(app)
      .post('/login')
      .set('Cookie', loginForm.cookies)
      .type('form')
      .send({ email, password: STRONG_PASSWORD, _csrf: loginForm.csrfToken });
    const loggedIn = mergeCookies(loginForm.cookies, loginRes);

    const beforeLogout = await request(app).get('/portal').set('Cookie', loggedIn);
    expect(beforeLogout.status).toBe(200);
    const token = extractCsrfToken(beforeLogout.text);

    const logoutRes = await request(app)
      .post('/logout')
      .set('Cookie', loggedIn)
      .type('form')
      .send({ _csrf: token });

    expect(logoutRes.status).toBe(303);

    // logout tells the browser to drop the cookie (maxAge=0) — a
    // well-behaved client loses access immediately.
    const clearedCookie = (logoutRes.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('waylen.sid='),
    );
    expect(clearedCookie).toMatch(/waylen\.sid=;/);
    expect(clearedCookie?.toLowerCase()).toMatch(/max-age=0/);

    const afterLogoutNoCookie = await request(app).get('/portal');
    expect(afterLogoutNoCookie.status).toBe(302);
    expect(afterLogoutNoCookie.headers.location).toBe('/login');

    // KNOWN GAP (see audit report): sessions are self-contained signed
    // cookies with no server-side revocation list, and logout does not
    // touch passwordChangedAt (correctly — no credential changed). So the
    // *exact pre-logout cookie value*, if captured before logout (XSS,
    // shared device, a proxy log), is still cryptographically valid and
    // still works after "logout" — bounded only by SESSION_TTL_HOURS. This
    // assertion documents that current behaviour rather than a desired one.
    const replayedStaleCookie = await request(app).get('/portal').set('Cookie', loggedIn);
    expect(replayedStaleCookie.status).toBe(200);
  }, 15_000);
});

describe('API login brute-force protection', () => {
  // express-rate-limit is deliberately disabled in NODE_ENV=test (skipInTest,
  // in middleware/rateLimit.ts) so the other ~30 tests in this file aren't
  // rate-limited against each other — so this checks the fix structurally
  // (the same limiter instance is wired into the route) rather than by
  // trying to trigger a real 429 under a limiter that's intentionally off.
  it('wires authRateLimiter into POST /api/v1/auth/login, matching the web login route', async () => {
    const { authApiRouter } = await import('../../src/routes/api/auth.routes.js');
    const { authRateLimiter } = await import('../../src/middleware/rateLimit.js');

    type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } };
    const loginLayer = (authApiRouter.stack as RouteLayer[]).find(
      (layer) => layer.route?.path === '/login' && layer.route.methods.post,
    );

    expect(loginLayer).toBeDefined();
    const hasRateLimiter = loginLayer!.route!.stack.some((l) => l.handle === authRateLimiter);
    expect(hasRateLimiter).toBe(true);
  });
});
