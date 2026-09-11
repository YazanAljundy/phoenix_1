import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { shouldClearSession } from './sessionError';

describe('shouldClearSession', () => {
  it('clears on an explicit credential rejection', () => {
    expect(shouldClearSession(new ApiError('Invalid or expired token.', 401))).toBe(true);
    expect(shouldClearSession(new ApiError('This account has been blocked.', 403))).toBe(true);
  });

  it('keeps the session when the server is merely unwell', () => {
    // Restarting backend, MongoDB unavailable, a 502 from the proxy in front
    // of it. None of these say anything about the token.
    for (const status of [500, 502, 503, 504]) {
      expect(shouldClearSession(new ApiError('Server error', status))).toBe(false);
    }
  });

  it('keeps the session when fetch never reached the server', () => {
    // This is the shape fetch() actually throws when the host is unreachable:
    // a bare TypeError with no `status` at all. Reading `.status` off it must
    // not be mistaken for a rejection.
    const networkFailure = new TypeError('Failed to fetch');
    expect(networkFailure.status).toBeUndefined();
    expect(shouldClearSession(networkFailure)).toBe(false);
  });

  it('keeps the session for anything malformed', () => {
    expect(shouldClearSession(undefined)).toBe(false);
    expect(shouldClearSession(null)).toBe(false);
    expect(shouldClearSession({})).toBe(false);
    expect(shouldClearSession('401')).toBe(false);
  });

  it('does not treat a 404 or a 429 as a dead session', () => {
    expect(shouldClearSession(new ApiError('Not found', 404))).toBe(false);
    expect(shouldClearSession(new ApiError('Too many requests', 429))).toBe(false);
  });
});
