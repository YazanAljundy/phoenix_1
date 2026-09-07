import { describe, expect, it } from 'vitest';
import en from './en/translation.json';
import ar from './ar/translation.json';

// The warehouse "Debts" section was renamed to "Invoices" - a user-facing
// label change only. These pin that the nav label and the section's own
// back-link/empty-state no longer say "Debts" / "الديون".
describe('warehouse Invoices section labels', () => {
  it('the nav label is "Invoices" / "الفواتير"', () => {
    expect(en.nav.debts).toBe('Invoices');
    expect(ar.nav.debts).toBe('الفواتير');
  });

  it('no user-facing string in the section still says "Debts" / "الديون"', () => {
    const strings = [
      en.nav.debts,
      en.debts.backToDebts,
      en.debts.noDebts,
      ar.nav.debts,
      ar.debts.backToDebts,
      ar.debts.noDebts,
    ];
    for (const s of strings) {
      expect(s.toLowerCase()).not.toContain('debt');
      expect(s).not.toContain('دين');
      expect(s).not.toContain('ديون');
    }
  });

  it('the back link points to invoices', () => {
    expect(en.debts.backToDebts).toBe('Back to invoices');
    expect(ar.debts.backToDebts).toBe('رجوع للفواتير');
  });

  // Money-Flow V2 replaced the detail view with an account statement, so the
  // two V1 cache columns ("Total orders" / "Total paid", read off the retired
  // PharmacyBalance) are gone. The labels the statement actually uses are
  // pinned instead - and both languages have to carry them.
  it('the detail view carries the statement labels in both languages', () => {
    for (const table of [en, ar]) {
      for (const key of ['title', 'date', 'type', 'reference', 'debit', 'credit', 'balance', 'opening']) {
        expect(table.statement[key], key).toBeTruthy();
      }
      expect(table.debts.balance).toBeTruthy();
      expect(table.debts.payments).toBeTruthy();
      expect(table.debts.lastActivity).toBeTruthy();
    }
  });

  it('the retired V1 cache labels are gone', () => {
    expect(en.debts.totalOrders).toBeUndefined();
    expect(en.debts.totalPaid).toBeUndefined();
    expect(ar.debts.totalOrders).toBeUndefined();
    expect(ar.debts.totalPaid).toBeUndefined();
  });
});
