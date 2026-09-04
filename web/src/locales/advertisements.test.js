import { describe, expect, it } from 'vitest';
import en from './en/translation.json';
import ar from './ar/translation.json';

// The advertisement pages are pure-React with no jsdom harness in this
// project, so what is testable here is the contract they depend on: every
// key they render exists in BOTH locales, nothing is hardcoded English, and
// the two pricing levels stay distinctly labelled.

// Every t() key the two advertisement pages use, relative to `advertisements`.
const KEYS = [
  'newAdvertisement',
  'modalTitle',
  'editTitle',
  'approvalNotice',
  'noAdvertisements',
  'titleEn',
  'titleAr',
  'titleColumn',
  'productsColumn',
  'searchProduct',
  'searchPlaceholder',
  'noProductsFound',
  'alreadyAdded',
  'selectedProducts',
  'noProductsSelected',
  'catalogPrice',
  'quantity',
  'calculatedTotal',
  'totalPrice',
  'savingPercent',
  'totalNotBelowSum',
  'atLeastOneProduct',
  'quantityPositive',
  'totalPositive',
  'rateRequired',
  'submitting',
  'submitForApproval',
  'confirmDelete',
  'numberColumn',
  // The "contact admin on WhatsApp" flow, mirrored from the banner page.
  'whatsappRequest',
  'whatsappRequestMessage',
  'successTitle',
  'successBody',
  'contactAdmin',
  'paymentWhatsappMessage',
];

const ADMIN_KEYS = [
  'warehouseColumn',
  'pendingCountLabel',
  'noAdvertisements',
  'rejectionHint',
  'confirmApprove',
  'rejectPrompt',
  'rejectionNoteRequired',
];

const STATUSES = ['pending', 'approved', 'rejected'];

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

describe('advertisement translations', () => {
  it('every key the pages render exists in both locales', () => {
    for (const key of KEYS) {
      expect(nonEmptyString(en.advertisements[key]), `en.advertisements.${key}`).toBe(true);
      expect(nonEmptyString(ar.advertisements[key]), `ar.advertisements.${key}`).toBe(true);
    }
  });

  it('every admin moderation key exists in both locales', () => {
    for (const key of ADMIN_KEYS) {
      expect(nonEmptyString(en.advertisements.admin[key]), `en.advertisements.admin.${key}`).toBe(true);
      expect(nonEmptyString(ar.advertisements.admin[key]), `ar.advertisements.admin.${key}`).toBe(true);
    }
  });

  // The page renders these as t(`advertisements.status.${status}`) straight
  // from the API's status field, so a missing one would show a raw key.
  it('every advertisement status the API can return has a label', () => {
    for (const status of STATUSES) {
      expect(nonEmptyString(en.advertisements.status[status]), `en status ${status}`).toBe(true);
      expect(nonEmptyString(ar.advertisements.status[status]), `ar status ${status}`).toBe(true);
    }
  });

  it('the nav label is translated, not left in English', () => {
    expect(en.nav.advertisements).toBe('Advertisements');
    expect(ar.nav.advertisements).toBe('الإعلانات');
  });

  // The banners tab and the packages tab used to sit side by side in the
  // sidebar, and BOTH rendered as "الإعلانات" - the same label twice, with no
  // way to tell them apart. They are now one tab with two sub-sections, so
  // what matters is that those two sub-labels are distinct.
  describe('the merged Advertisements tab', () => {
    it('both sub-section labels exist in each locale', () => {
      for (const [name, locale] of [['en', en], ['ar', ar]]) {
        expect(nonEmptyString(locale.nav.advertisementsGeneral), `${name} general`).toBe(true);
        expect(nonEmptyString(locale.nav.advertisementsPackages), `${name} packages`).toBe(true);
      }
    });

    it('the two sub-labels are distinct from each other and from the parent', () => {
      for (const [name, locale] of [['en', en], ['ar', ar]]) {
        expect(locale.nav.advertisementsGeneral, `${name}: sub-labels collide`).not.toBe(
          locale.nav.advertisementsPackages
        );
        expect(locale.nav.advertisementsGeneral, `${name}: general == parent`).not.toBe(
          locale.nav.advertisements
        );
        expect(locale.nav.advertisementsPackages, `${name}: packages == parent`).not.toBe(
          locale.nav.advertisements
        );
      }
    });

    it('the Arabic sub-labels are Arabic, not an English fallback', () => {
      expect(ar.nav.advertisementsGeneral).not.toBe(en.nav.advertisementsGeneral);
      expect(ar.nav.advertisementsPackages).not.toBe(en.nav.advertisementsPackages);
    });

    // Removed when the tabs merged - a leftover would put a dead entry back in
    // the sidebar the moment someone reused the key.
    it('the old standalone banners nav label is gone', () => {
      expect(en.nav.banners).toBeUndefined();
      expect(ar.nav.banners).toBeUndefined();
    });
  });

  it('the picker Add/Remove buttons are translated', () => {
    expect(en.common.add).toBe('Add');
    expect(en.common.remove).toBe('Remove');
    expect(nonEmptyString(ar.common.add)).toBe(true);
    expect(nonEmptyString(ar.common.remove)).toBe(true);
    // Arabic must actually be Arabic - a copy-pasted English fallback here
    // would silently ship an untranslated button.
    expect(ar.common.add).not.toBe(en.common.add);
    expect(ar.common.remove).not.toBe(en.common.remove);
  });

  // The warehouse must be able to tell the products' catalog total from the
  // package price at a glance.
  it('the two pricing levels are labelled distinctly', () => {
    expect(en.advertisements.calculatedTotal).not.toBe(en.advertisements.totalPrice);
    expect(ar.advertisements.calculatedTotal).not.toBe(ar.advertisements.totalPrice);
    expect(en.advertisements.catalogPrice).not.toBe(en.advertisements.totalPrice);
  });

  it('interpolated placeholders match between locales', () => {
    const withPlaceholders = {
      confirmDelete: '{{title}}',
      savingPercent: '{{percent}}',
      'admin.pendingCountLabel': '{{count}}',
      'admin.confirmApprove': '{{title}}',
      'admin.rejectPrompt': '{{title}}',
      whatsappRequestMessage: '{{warehouseName}}',
    };
    for (const [path, placeholder] of Object.entries(withPlaceholders)) {
      const read = (root) => path.split('.').reduce((node, part) => node[part], root.advertisements);
      expect(read(en), `en ${path}`).toContain(placeholder);
      expect(read(ar), `ar ${path}`).toContain(placeholder);
    }
  });

  // The WhatsApp payment message carries the warehouse id and the
  // advertisement number so the admin knows which submission to bill - both
  // placeholders must survive translation.
  it('the payment WhatsApp message keeps its warehouse id + advertisement number', () => {
    for (const [name, locale] of [['en', en], ['ar', ar]]) {
      expect(locale.advertisements.paymentWhatsappMessage, `${name} warehouseId`).toContain(
        '{{warehouseId}}'
      );
      expect(locale.advertisements.paymentWhatsappMessage, `${name} advertisementNumber`).toContain(
        '{{advertisementNumber}}'
      );
    }
  });

  it('the WhatsApp strings are actually Arabic, not an English fallback', () => {
    expect(ar.advertisements.whatsappRequest).not.toBe(en.advertisements.whatsappRequest);
    expect(ar.advertisements.contactAdmin).not.toBe(en.advertisements.contactAdmin);
    expect(ar.advertisements.successTitle).not.toBe(en.advertisements.successTitle);
  });
});
