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

  // The detail view keeps its existing financial labels untouched.
  it('detail financial labels are unchanged', () => {
    expect(en.debts.totalOrders).toBe('Total orders');
    expect(en.debts.totalPaid).toBe('Total paid');
    expect(en.debts.balance).toBe('Balance');
    expect(en.debts.payments).toBe('Payments');
  });
});
