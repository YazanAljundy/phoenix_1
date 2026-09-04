import { describe, expect, it } from 'vitest';
import {
  formatSyp,
  formatUsd,
  sypFromUsd,
  formatMoneyFromUsd,
  formatUsdAsSyp,
  remainingPaymentAmount,
} from './currency';

// SYP is the panel's primary display currency; the catalog still stores USD.
describe('SYP formatting', () => {
  it('formatSyp groups thousands and appends the suffix', () => {
    expect(formatSyp(100000)).toBe('100,000 ل.س');
    expect(formatSyp(1500000)).toBe('1,500,000 ل.س');
    expect(formatSyp(750.6)).toBe('751 ل.س'); // whole lira
  });

  it('formatUsd shows two decimals with a leading dollar sign', () => {
    expect(formatUsd(25)).toBe('$25.00');
    expect(formatUsd(2.5)).toBe('$2.50');
  });

  it('sypFromUsd multiplies by the rate and rounds (matches order pricing)', () => {
    expect(sypFromUsd(10, 5000)).toBe(50000);
    expect(sypFromUsd(2.53, 130)).toBe(329);
    expect(sypFromUsd(10, null)).toBeNull();
    expect(sypFromUsd(10, 0)).toBeNull();
  });

  it('formatMoneyFromUsd shows SYP when a rate is available, USD as a fallback', () => {
    expect(formatMoneyFromUsd(25, 1000)).toBe('25,000 ل.س');
    expect(formatMoneyFromUsd(25, null)).toBe('$25.00');
  });

  it('formatUsdAsSyp is SYP-primary with the exact USD as a parenthetical hint', () => {
    expect(formatUsdAsSyp(25, 1000)).toBe('25,000 ل.س ($25.00)');
    expect(formatUsdAsSyp(25, null)).toBe('$25.00');
  });
});

// Backs the "Full amount" button on the record-payment forms: it prefills the
// outstanding balance (stored in USD) into the amount field, converted to the
// currency the warehouse picked.
describe('remainingPaymentAmount', () => {
  it('returns the USD balance as-is when USD is selected', () => {
    expect(remainingPaymentAmount(100, 'USD', 15000)).toBe(100);
    expect(remainingPaymentAmount(12.345, 'USD', null)).toBe(12.35); // rounded to cents
  });

  it('converts to whole lira when SYP is selected', () => {
    expect(remainingPaymentAmount(10, 'SYP', 15000)).toBe(150000);
    expect(remainingPaymentAmount(1.5, 'SYP', 10000)).toBe(15000);
  });

  it('is null (button disabled) when nothing is owed', () => {
    expect(remainingPaymentAmount(0, 'USD', 15000)).toBeNull();
    expect(remainingPaymentAmount(-25, 'USD', 15000)).toBeNull(); // a credit
  });

  it('is null (button disabled) for SYP with no exchange rate loaded', () => {
    expect(remainingPaymentAmount(100, 'SYP', null)).toBeNull();
    expect(remainingPaymentAmount(100, 'SYP', undefined)).toBeNull();
  });

  it('is null for an unexpected currency or a non-numeric balance', () => {
    expect(remainingPaymentAmount(100, 'EUR', 15000)).toBeNull();
    expect(remainingPaymentAmount('abc', 'USD', 15000)).toBeNull();
  });
});
