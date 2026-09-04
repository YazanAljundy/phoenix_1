import { describe, expect, it } from 'vitest';
import en from './en/translation.json';
import ar from './ar/translation.json';

// The Offers pages are pure-React with no jsdom harness in this project, so
// what's testable here is the contract they depend on: every key they render
// exists in BOTH locales, and the interpolation placeholders line up.

const OFFERS_KEYS = ['searchPlaceholder', 'discountMin', 'discountMax', 'noneMatchFilter'];
const FILTER_KEYS = ['all', 'review', 'active', 'upcoming', 'expired', 'permanent'];
const WAREHOUSE_KEYS = [
  'newOffer',
  'modalTitle',
  'editTitle',
  'saveChanges',
  'selectProduct',
  'titleEn',
  'titleAr',
  'discountPercentage',
  'permanentOffer',
  'permanentOfferHint',
  'permanentLabel',
  'submitting',
  'submitForApproval',
  'noOffers',
  'confirmDelete',
  'updatePendingBadge',
  'statusApproved',
  'statusPending',
  'discountRange',
  'approvalNotice',
  'fromColumn',
  'toColumn',
];
const ADMIN_KEYS = [
  'noOffers',
  'rejectionHint',
  'warehouseColumn',
  'productColumn',
  'discountColumn',
  'proposedLabel',
  'updateRequestBadge',
  'editTitle',
  'confirmApprove',
  'confirmReject',
  'confirmRejectUpdate',
  'confirmDelete',
];

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

describe('offer translations', () => {
  it('every offers.* key exists in both locales', () => {
    for (const key of OFFERS_KEYS) {
      expect(nonEmptyString(en.offers[key]), `en.offers.${key}`).toBe(true);
      expect(nonEmptyString(ar.offers[key]), `ar.offers.${key}`).toBe(true);
    }
  });

  it('every filter pill label exists in both locales', () => {
    for (const key of FILTER_KEYS) {
      expect(nonEmptyString(en.offers.filters[key]), `en.offers.filters.${key}`).toBe(true);
      expect(nonEmptyString(ar.offers.filters[key]), `ar.offers.filters.${key}`).toBe(true);
    }
  });

  it('every warehouse key the page renders exists in both locales', () => {
    for (const key of WAREHOUSE_KEYS) {
      expect(nonEmptyString(en.offers.warehouse[key]), `en.offers.warehouse.${key}`).toBe(true);
      expect(nonEmptyString(ar.offers.warehouse[key]), `ar.offers.warehouse.${key}`).toBe(true);
    }
  });

  it('every admin key the page renders exists in both locales', () => {
    for (const key of ADMIN_KEYS) {
      expect(nonEmptyString(en.offers.admin[key]), `en.offers.admin.${key}`).toBe(true);
      expect(nonEmptyString(ar.offers.admin[key]), `ar.offers.admin.${key}`).toBe(true);
    }
  });

  it('the Arabic labels are actually Arabic, not an English fallback', () => {
    expect(ar.offers.warehouse.permanentOffer).not.toBe(en.offers.warehouse.permanentOffer);
    expect(ar.offers.warehouse.editTitle).not.toBe(en.offers.warehouse.editTitle);
    expect(ar.offers.filters.permanent).not.toBe(en.offers.filters.permanent);
    expect(ar.offers.admin.proposedLabel).not.toBe(en.offers.admin.proposedLabel);
  });

  it('interpolated placeholders match between locales', () => {
    const withPlaceholders = {
      'filters.review': '{{count}}',
      'admin.confirmApprove': '{{title}}',
      'admin.confirmReject': '{{title}}',
      'admin.confirmRejectUpdate': '{{title}}',
      'admin.confirmDelete': '{{title}}',
      percentOff: '{{percent}}',
    };
    for (const [path, placeholder] of Object.entries(withPlaceholders)) {
      const read = (root) => path.split('.').reduce((node, part) => node[part], root.offers);
      expect(read(en), `en offers.${path}`).toContain(placeholder);
      expect(read(ar), `ar offers.${path}`).toContain(placeholder);
    }
  });

  it('the removed keys are gone (a leftover would silently resurface)', () => {
    expect(en.offers.admin.confirmDecision).toBeUndefined();
    expect(en.offers.admin.pendingCountLabel).toBeUndefined();
  });
});
