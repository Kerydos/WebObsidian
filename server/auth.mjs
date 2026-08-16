import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'webobsidian_session';

export class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest();
}

export class AuthManager {
  constructor(password, {
    now = () => Date.now(),
    sessionTtlMs = 7 * 24 * 60 * 60 * 1000,
    attemptWindowMs = 15 * 60 * 1000,
    maxAttempts = 5,
  } = {}) {
    if (!password || password.length < 12) {
      throw new Error('WEBOBSIDIAN_PASSWORD는 12자 이상으로 설정해야 합니다.');
    }
    this.passwordDigest = digest(password);
    this.now = now;
    this.sessionTtlMs = sessionTtlMs;
    this.attemptWindowMs = attemptWindowMs;
    this.maxAttempts = maxAttempts;
    this.sessions = new Map();
    this.attempts = new Map();
  }

  login(password, clientId) {
    const now = this.now();
    const attempt = this.attempts.get(clientId);
    if (attempt && attempt.resetAt > now && attempt.count >= this.maxAttempts) {
      throw new AuthError('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.', 429);
    }
    if (typeof password !== 'string' || !timingSafeEqual(digest(password ?? ''), this.passwordDigest)) {
      const count = attempt && attempt.resetAt > now ? attempt.count + 1 : 1;
      this.attempts.set(clientId, { count, resetAt: now + this.attemptWindowMs });
      if (count >= this.maxAttempts) {
        throw new AuthError('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.', 429);
      }
      throw new AuthError('비밀번호가 올바르지 않습니다.', 401);
    }

    this.attempts.delete(clientId);
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, now + this.sessionTtlMs);
    return token;
  }

  isAuthenticated(token) {
    if (!token) return false;
    const expiresAt = this.sessions.get(token);
    if (!expiresAt || expiresAt <= this.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  logout(token) {
    if (token) this.sessions.delete(token);
  }
}

export function readSessionToken(cookieHeader = '') {
  for (const cookie of cookieHeader.split(';')) {
    const [name, ...value] = cookie.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=');
  }
  return undefined;
}

export function sessionCookie(token, { secure = false, maxAge = 7 * 24 * 60 * 60 } = {}) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function expiredSessionCookie({ secure = false } = {}) {
  return sessionCookie('', { secure, maxAge: 0 });
}
