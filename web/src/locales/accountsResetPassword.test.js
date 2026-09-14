import { describe, expect, it } from 'vitest';
import en from './en/translation.json';
import ar from './ar/translation.json';

// The Accounts page's emergency password-reset modal is plain React with no
// jsdom harness in this project, so what is testable here is its l10n
// contract - the same approach deliverySeal.test.js and offers.test.js take:
// every key it renders exists in both locales, is actually translated, and the
// interpolation placeholders line up between them.

const KEYS = [
  'title',
  'hint',
  'passwordLabel',
  'passwordHint',
  'show',
  'hide',
  'reasonLabel',
  'reasonPlaceholder',
  'sessionWarning',
  'submit',
  'submitting',
  'success',
  'errorTooShort',
  'errorNotFound',
  'errorDeleted',
  'errorForbidden',
  'errorRateLimited',
];

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function placeholders(value) {
  return (value.match(/\{\{(\w+)\}\}/g) ?? []).sort();
}

describe('accounts: emergency password reset translations', () => {
  it('the row action label exists in both locales', () => {
    expect(nonEmptyString(en.admin.accounts.action.resetPassword)).toBe(true);
    expect(nonEmptyString(ar.admin.accounts.action.resetPassword)).toBe(true);
    expect(ar.admin.accounts.action.resetPassword).not.toBe(en.admin.accounts.action.resetPassword);
  });

  it('every modal key exists in both locales', () => {
    for (const key of KEYS) {
      expect(nonEmptyString(en.admin.accounts.resetPassword[key]), `en.${key}`).toBe(true);
      expect(nonEmptyString(ar.admin.accounts.resetPassword[key]), `ar.${key}`).toBe(true);
    }
  });

  it('the Arabic strings are translated, not the English left as a fallback', () => {
    for (const key of KEYS) {
      expect(ar.admin.accounts.resetPassword[key], `ar.${key} is the EN string`).not.toBe(
        en.admin.accounts.resetPassword[key]
      );
    }
  });

  // A placeholder present in one locale and missing in the other renders a
  // literal {{min}} / a nameless sentence to whichever half of the audience
  // reads that language.
  it('placeholders match between locales', () => {
    for (const key of KEYS) {
      expect(placeholders(ar.admin.accounts.resetPassword[key]), `placeholders for ${key}`).toEqual(
        placeholders(en.admin.accounts.resetPassword[key])
      );
    }
  });

  it('the keys that name an account or a length carry their placeholder', () => {
    for (const locale of [en, ar]) {
      const block = locale.admin.accounts.resetPassword;
      expect(placeholders(block.hint)).toContain('{{name}}');
      expect(placeholders(block.success)).toContain('{{name}}');
      expect(placeholders(block.passwordHint)).toContain('{{min}}');
      expect(placeholders(block.errorTooShort)).toContain('{{min}}');
    }
  });

  // The one warning the modal has to carry: the reset restores access, it does
  // not revoke it. If this text is ever rewritten into something vaguer, the
  // admin loses the only cue that Block is the tool for a compromised account.
  it('the session warning is substantial in both locales', () => {
    expect(en.admin.accounts.resetPassword.sessionWarning.length).toBeGreaterThan(60);
    expect(ar.admin.accounts.resetPassword.sessionWarning.length).toBeGreaterThan(60);
  });
});
