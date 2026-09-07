import { describe, expect, it } from 'vitest';
import en from './en/translation.json';
import ar from './ar/translation.json';

// The admin Commission Collection screen. There is no component-testing setup
// in this panel, so what is pinned here is the thing that has actually broken
// before: a screen shipping with keys in one language and not the other, which
// renders as the raw key string to whoever is using the panel in Arabic.
//
// Every key the page reads is listed - if one is added to the page and not to
// both files, this fails rather than the panel.
const KEYS = [
  'warehouse',
  'sales',
  'salesHint',
  'returns',
  'returnsHint',
  'owed',
  'owedHint',
  'collected',
  'outstanding',
  'collectedSoFar',
  'overpaidHint',
  'clickRowHint',
  'ordersBreakdown',
  'backToList',
  'recordCollection',
  'recordCollectionHint',
  'recordCollectionButton',
  'amount',
  'amountPositive',
  'fullOutstanding',
  'notePlaceholder',
  'history',
  'noCollections',
  'coversPeriod',
  'details',
  'reverseTitle',
  'reverseExplain',
  'reverseReasonRequired',
  'reverseReasonPlaceholder',
  'reverseButton',
];

describe('admin commission collection strings', () => {
  it('every key exists in both languages', () => {
    for (const [name, table] of [['en', en], ['ar', ar]]) {
      for (const key of KEYS) {
        expect(table.commission?.[key], `${name}.commission.${key}`).toBeTruthy();
      }
    }
  });

  it('the two languages carry exactly the same key set', () => {
    expect(Object.keys(ar.commission).sort()).toEqual(Object.keys(en.commission).sort());
  });

  it('the nav label is there in both languages', () => {
    expect(en.nav.commission).toBe('Commission');
    expect(ar.nav.commission).toBeTruthy();
  });

  // The page reuses the payment vocabulary rather than duplicating it, so the
  // method labels a collection renders come out of the debts block. Missing
  // ones would render as "debts.method_cheque" inside the form's dropdown.
  it('the payment-method labels the collection form reuses exist', () => {
    for (const table of [en, ar]) {
      for (const method of ['cash', 'bank_transfer', 'cheque', 'other']) {
        expect(table.debts[`method_${method}`], method).toBeTruthy();
      }
      expect(table.debts.reverse).toBeTruthy();
      expect(table.debts.reverseReason).toBeTruthy();
      expect(table.debts.reversedBecause).toBeTruthy();
      expect(table.debts.referenceOptional).toBeTruthy();
      expect(table.debts.noteOptional).toBeTruthy();
    }
  });

  // Interpolations are the other half of a string that silently renders wrong:
  // a placeholder dropped in one language shows an empty gap where a figure
  // should be.
  it('the interpolated strings keep their placeholders in both languages', () => {
    for (const table of [en, ar]) {
      expect(table.commission.collectedSoFar).toContain('{{amount}}');
      expect(table.commission.reverseExplain).toContain('{{amount}}');
      expect(table.commission.recordCollectionHint).toContain('{{from}}');
      expect(table.commission.recordCollectionHint).toContain('{{to}}');
    }
  });
});
