import { describe, expect, it } from 'vitest';
import { AuthManager, expiredSessionCookie, readSessionToken, sessionCookie } from './auth.mjs';

describe('server authentication', () => {
  it('requires a sufficiently long configured password', () => {
    expect(() => new AuthManager('short')).toThrow('12자 이상');
  });

  it('creates and expires sessions', () => {
    let now = 1_000;
    const auth = new AuthManager('correct horse', { now: () => now, sessionTtlMs: 100 });
    const token = auth.login('correct horse', 'client');

    expect(auth.isAuthenticated(token)).toBe(true);
    now += 101;
    expect(auth.isAuthenticated(token)).toBe(false);
  });

  it('invalidates sessions on logout', () => {
    const auth = new AuthManager('secret-value');
    const token = auth.login('secret-value', 'client');
    auth.logout(token);
    expect(auth.isAuthenticated(token)).toBe(false);
  });

  it('rate limits repeated invalid passwords', () => {
    const auth = new AuthManager('secret-value', { maxAttempts: 2 });

    expect(() => auth.login('wrong', 'client')).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => auth.login('wrong', 'client')).toThrow(expect.objectContaining({ status: 429 }));
    expect(() => auth.login('secret-value', 'client')).toThrow(expect.objectContaining({ status: 429 }));
  });

  it('uses a secure HttpOnly session cookie', () => {
    const cookie = sessionCookie('token', { secure: true });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(readSessionToken(`theme=dark; ${cookie}`)).toBe('token');
    expect(expiredSessionCookie()).toContain('Max-Age=0');
  });
});
