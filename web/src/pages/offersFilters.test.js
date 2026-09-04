import { describe, expect, it } from 'vitest';
import { filterOffers, isInReview, matchesOfferFilter, offerEditSource, reviewCount } from './offersFilters';

// A fixed "now" so the date-window filters are deterministic.
const NOW = new Date('2026-06-15T12:00:00Z');

function offer(overrides = {}) {
  return {
    id: overrides.id ?? 'o1',
    status: 'approved',
    isPermanent: false,
    startDate: '2026-06-01T00:00:00Z',
    endDate: '2026-06-30T00:00:00Z',
    discountPercentage: 20,
    pendingUpdate: null,
    productNameEn: 'Panadol',
    productNameAr: 'بانادول',
    titleEn: 'Summer deal',
    titleAr: 'عرض الصيف',
    warehouseNameEn: 'Alpha Warehouse',
    warehouseNameAr: 'مستودع ألفا',
    ...overrides,
  };
}

describe('isInReview', () => {
  it('is true for a brand-new pending offer', () => {
    expect(isInReview(offer({ status: 'pending' }))).toBe(true);
  });
  it('is true for an approved offer with a parked edit', () => {
    expect(isInReview(offer({ status: 'approved', pendingUpdate: { discountPercentage: 30 } }))).toBe(true);
  });
  it('is false for a plain approved offer', () => {
    expect(isInReview(offer())).toBe(false);
  });
});

describe('matchesOfferFilter', () => {
  it('"all" matches everything', () => {
    expect(matchesOfferFilter(offer({ status: 'pending' }), 'all', NOW)).toBe(true);
  });

  it('"review" matches only the moderation queue', () => {
    expect(matchesOfferFilter(offer({ status: 'pending' }), 'review', NOW)).toBe(true);
    expect(matchesOfferFilter(offer({ pendingUpdate: { x: 1 } }), 'review', NOW)).toBe(true);
    expect(matchesOfferFilter(offer(), 'review', NOW)).toBe(false);
  });

  it('"active" is an approved offer whose window contains now', () => {
    expect(matchesOfferFilter(offer(), 'active', NOW)).toBe(true);
    expect(matchesOfferFilter(offer({ status: 'pending' }), 'active', NOW)).toBe(false);
    expect(matchesOfferFilter(offer({ startDate: '2026-07-01T00:00:00Z' }), 'active', NOW)).toBe(false);
    expect(matchesOfferFilter(offer({ endDate: '2026-06-10T00:00:00Z' }), 'active', NOW)).toBe(false);
  });

  it('"active" includes a started permanent offer', () => {
    expect(matchesOfferFilter(offer({ isPermanent: true, endDate: null }), 'active', NOW)).toBe(true);
  });

  it('"upcoming" is an approved offer that has not started', () => {
    expect(matchesOfferFilter(offer({ startDate: '2026-07-01T00:00:00Z' }), 'upcoming', NOW)).toBe(true);
    expect(matchesOfferFilter(offer(), 'upcoming', NOW)).toBe(false);
  });

  it('"expired" is a past-endDate, non-permanent approved offer', () => {
    expect(matchesOfferFilter(offer({ endDate: '2026-06-10T00:00:00Z' }), 'expired', NOW)).toBe(true);
    expect(matchesOfferFilter(offer({ isPermanent: true, endDate: null }), 'expired', NOW)).toBe(false);
    expect(matchesOfferFilter(offer(), 'expired', NOW)).toBe(false);
  });

  it('"permanent" matches on the flag regardless of dates/status', () => {
    expect(matchesOfferFilter(offer({ isPermanent: true, endDate: null }), 'permanent', NOW)).toBe(true);
    expect(matchesOfferFilter(offer(), 'permanent', NOW)).toBe(false);
  });
});

describe('filterOffers', () => {
  const list = [
    offer({ id: 'active', discountPercentage: 10 }),
    offer({ id: 'permanent', isPermanent: true, endDate: null, discountPercentage: 50, productNameEn: 'Aspirin' }),
    offer({ id: 'upcoming', startDate: '2026-07-01T00:00:00Z', endDate: '2026-08-01T00:00:00Z' }),
    offer({ id: 'expired', endDate: '2026-05-01T00:00:00Z' }),
    offer({ id: 'pending', status: 'pending' }),
  ];

  it('status pill narrows the list', () => {
    expect(filterOffers(list, { status: 'permanent' }, NOW).map((o) => o.id)).toEqual(['permanent']);
    expect(filterOffers(list, { status: 'review' }, NOW).map((o) => o.id)).toEqual(['pending']);
    expect(filterOffers(list, { status: 'expired' }, NOW).map((o) => o.id)).toEqual(['expired']);
  });

  it('discount range is inclusive on both ends', () => {
    expect(filterOffers(list, { discountMin: 50 }, NOW).map((o) => o.id)).toEqual(['permanent']);
    expect(filterOffers(list, { discountMax: 10 }, NOW).map((o) => o.id)).toEqual(['active']);
    expect(filterOffers(list, { discountMin: 20, discountMax: 20 }, NOW).map((o) => o.id).sort()).toEqual(
      ['expired', 'pending', 'upcoming']
    );
  });

  it('search matches product name, title or warehouse, case-insensitively', () => {
    expect(filterOffers(list, { search: 'aspirin' }, NOW).map((o) => o.id)).toEqual(['permanent']);
    expect(filterOffers(list, { search: 'ALPHA' }, NOW).length).toBe(list.length);
    expect(filterOffers(list, { search: 'nothing-here' }, NOW)).toEqual([]);
  });

  it('search also looks at a parked edit\'s product name', () => {
    const withEdit = [offer({ id: 'e', pendingUpdate: { productNameEn: 'Brufen', productNameAr: 'بروفين' } })];
    expect(filterOffers(withEdit, { search: 'brufen' }, NOW).map((o) => o.id)).toEqual(['e']);
  });

  it('empty filter object returns everything', () => {
    expect(filterOffers(list, {}, NOW).length).toBe(list.length);
  });
});

describe('offerEditSource', () => {
  it('returns the live offer when nothing is parked', () => {
    const o = offer();
    expect(offerEditSource(o)).toBe(o);
  });

  it('prefills from the parked edit, keeping the offer id', () => {
    const o = offer({
      id: 'x1',
      discountPercentage: 10,
      titleEn: 'live',
      pendingUpdate: { discountPercentage: 40, titleEn: 'proposed', isPermanent: true, endDate: null },
    });
    const source = offerEditSource(o);
    expect(source.id).toBe('x1');
    expect(source.discountPercentage).toBe(40);
    expect(source.titleEn).toBe('proposed');
    expect(source.isPermanent).toBe(true);
    expect(source.endDate).toBe(null);
  });

  it('tolerates null', () => {
    expect(offerEditSource(null)).toBe(null);
  });
});

describe('reviewCount', () => {
  it('counts new pending offers and parked edits together', () => {
    const list = [
      offer(),
      offer({ status: 'pending' }),
      offer({ pendingUpdate: { x: 1 } }),
    ];
    expect(reviewCount(list)).toBe(2);
  });
});
