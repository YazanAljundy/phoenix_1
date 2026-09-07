import { describe, expect, it } from 'vitest';
import {
  formatSyp,
  formatUsd,
  sypFromUsd,
  formatMoneyFromUsd,
  formatUsdAsSyp,
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
