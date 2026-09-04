// Pure helpers for the Offers pages' filter bar (warehouse + admin), kept out
// of the components so they can be unit-tested without a DOM. Mirrors the
// approach of accountsFilters.js.
//
// An offer row is the serialized shape from warehouseOffer/adminOffer
// viewmodels: { status, isPermanent, startDate, endDate, discountPercentage,
// pendingUpdate, productName*, titleAr/En, warehouseName* }.

export const OFFER_FILTERS = ['all', 'review', 'active', 'upcoming', 'expired', 'permanent'];

// Is this offer sitting in the admin moderation queue right now - either a
// brand-new offer awaiting approval, or an approved offer with a parked edit.
export function isInReview(offer) {
  return offer.status === 'pending' || Boolean(offer.pendingUpdate);
}

export function matchesOfferFilter(offer, filter, now = new Date()) {
  if (filter === 'all') return true;
  if (filter === 'review') return isInReview(offer);
  if (filter === 'permanent') return offer.isPermanent === true;

  // The remaining three describe an approved offer's date window.
  if (offer.status !== 'approved') return false;
  const start = new Date(offer.startDate);

  if (filter === 'upcoming') return start > now;
  if (filter === 'active') {
    if (start > now) return false;
    if (offer.isPermanent) return true;
    return !offer.endDate || new Date(offer.endDate) >= now;
  }
  if (filter === 'expired') {
    return !offer.isPermanent && Boolean(offer.endDate) && new Date(offer.endDate) < now;
  }
  return false;
}

function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Applies the status pill, the product/title/warehouse search box and the
// discount-percentage range in one pass.
export function filterOffers(offers, { status = 'all', search = '', discountMin, discountMax } = {}, now = new Date()) {
  const term = search.trim().toLowerCase();
  const min = toNumberOrNull(discountMin);
  const max = toNumberOrNull(discountMax);

  return offers.filter((offer) => {
    if (!matchesOfferFilter(offer, status, now)) return false;
    if (min !== null && offer.discountPercentage < min) return false;
    if (max !== null && offer.discountPercentage > max) return false;
    if (term) {
      const haystack = [
        offer.productNameEn,
        offer.productNameAr,
        offer.titleEn,
        offer.titleAr,
        offer.warehouseNameEn,
        offer.warehouseNameAr,
        offer.pendingUpdate?.productNameEn,
        offer.pendingUpdate?.productNameAr,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}

export function reviewCount(offers) {
  return offers.filter(isInReview).length;
}

// The values the warehouse Edit form should open with: the parked edit
// (`pendingUpdate`) if one exists - so revising it overwrites the same
// proposal rather than starting a parallel one - otherwise the live offer.
export function offerEditSource(offer) {
  if (!offer || !offer.pendingUpdate) return offer;
  return { ...offer, ...offer.pendingUpdate };
}
