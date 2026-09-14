import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH_BY_ROLE,
  canAdminResetPassword,
  minPasswordLengthFor,
  passwordPolicyError,
} from './passwordPolicy';

// This table mirrors backend/src/utils/password.js. If the server's numbers
// change, these are the assertions that should fail first and point at the
// copy that needs updating.
describe('password policy (mirror of the server table)', () => {
  it('holds the per-role minimums the server enforces', () => {
    expect(MIN_PASSWORD_LENGTH_BY_ROLE.pharmacy).toBe(8);
    expect(MIN_PASSWORD_LENGTH_BY_ROLE.warehouse).toBe(10);
    expect(MIN_PASSWORD_LENGTH_BY_ROLE.admin).toBe(12);
  });

  it('resolves a minimum per role', () => {
    expect(minPasswordLengthFor('pharmacy')).toBe(8);
    expect(minPasswordLengthFor('warehouse')).toBe(10);
    expect(minPasswordLengthFor('admin')).toBe(12);
  });

  // An unrecognised role must not be the weakest option - it is the strictest,
  // so a role this panel has not been taught about cannot be used to slip a
  // short password past the form.
  it('falls back to the strictest minimum for an unknown role', () => {
    expect(minPasswordLengthFor('something-new')).toBe(12);
    expect(minPasswordLengthFor(undefined)).toBe(12);
    expect(minPasswordLengthFor(null)).toBe(12);
  });

  describe('passwordPolicyError', () => {
    it('accepts a password exactly at the role minimum', () => {
      expect(passwordPolicyError('a'.repeat(8), 'pharmacy')).toBeNull();
      expect(passwordPolicyError('a'.repeat(10), 'warehouse')).toBeNull();
    });

    it('reports the required length when the password is one short', () => {
      expect(passwordPolicyError('a'.repeat(7), 'pharmacy')).toBe(8);
      expect(passwordPolicyError('a'.repeat(9), 'warehouse')).toBe(10);
    });

    // The case the endpoint exists to get right: the bar follows the TARGET
    // account's role, not the acting admin's. A 9-character password is fine
    // for a pharmacy and not for a warehouse.
    it('holds a warehouse to a higher bar than a pharmacy', () => {
      const nine = 'a'.repeat(9);
      expect(passwordPolicyError(nine, 'pharmacy')).toBeNull();
      expect(passwordPolicyError(nine, 'warehouse')).toBe(10);
    });

    it('rejects an empty or non-string password', () => {
      expect(passwordPolicyError('', 'pharmacy')).toBe(8);
      expect(passwordPolicyError(undefined, 'pharmacy')).toBe(8);
      expect(passwordPolicyError(null, 'warehouse')).toBe(10);
    });

    it('does not trim - a space is a character the server will accept too', () => {
      expect(passwordPolicyError('a'.repeat(7) + ' ', 'pharmacy')).toBeNull();
    });
  });

  // The Accounts page hides the Reset Password button on anything this rejects.
  describe('canAdminResetPassword', () => {
    it('allows the two roles the server will actually act on', () => {
      expect(canAdminResetPassword('pharmacy')).toBe(true);
      expect(canAdminResetPassword('warehouse')).toBe(true);
    });

    // The one that matters: an admin resetting another admin would make every
    // admin a lateral step to every other, so the server answers 404 and the
    // button must never be offered.
    it('never offers a reset for an admin account', () => {
      expect(canAdminResetPassword('admin')).toBe(false);
    });

    it('refuses an unknown or missing role rather than defaulting to allowed', () => {
      expect(canAdminResetPassword('something-new')).toBe(false);
      expect(canAdminResetPassword(undefined)).toBe(false);
      expect(canAdminResetPassword(null)).toBe(false);
      expect(canAdminResetPassword('')).toBe(false);
    });
  });
});
