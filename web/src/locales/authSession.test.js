import { describe, expect, it } from 'vitest';
import ar from './ar/translation.json';
import en from './en/translation.json';

// The Auth screens are pure React with no jsdom harness in this project, so
// what is testable here is the contract they depend on: every key the offline
// state renders exists in BOTH locales. A key present in only one falls back
// to the raw key string on screen, which is exactly the kind of regression
// that slips through code review.
describe('auth session strings', () => {
  const keys = [
    ['auth', 'connectionFailed'],
    ['auth', 'phoneLabel'],
    ['auth', 'passwordLabel'],
    ['auth', 'logIn'],
    ['auth', 'loggingIn'],
    ['common', 'retry'],
    ['common', 'loading'],
  ];

  for (const [namespace, key] of keys) {
    it(`${namespace}.${key} exists in both locales`, () => {
      expect(typeof en[namespace]?.[key]).toBe('string');
      expect(typeof ar[namespace]?.[key]).toBe('string');
      expect(en[namespace][key].length).toBeGreaterThan(0);
      expect(ar[namespace][key].length).toBeGreaterThan(0);
    });
  }

  it('the Arabic copy is actually translated, not the English left in place', () => {
    expect(ar.auth.connectionFailed).not.toBe(en.auth.connectionFailed);
    expect(ar.common.retry).not.toBe(en.common.retry);
  });
});
