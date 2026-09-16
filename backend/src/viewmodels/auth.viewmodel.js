function serializeUser(user) {
  return {
    id: user._id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    status: user.status,
    lang: user.lang,
  };
}

// Legacy rows created before areaType existed still have no value for it -
// pharmacy.model.js made it `required: true`, but that only constrains WRITES,
// and scripts/backfill-pharmacy-area-type.js has not necessarily run on every
// deployment yet. A missing value serialises to `undefined`, JSON.stringify
// drops the key entirely, and PharmacyModel.fromJson's `json['areaType'] as
// String` then throws a TypeError that auth_cubit.dart's `on Failure catch`
// does not catch - so the pharmacy app hangs on the login spinner with no
// error at all, for exactly the accounts that predate the field.
//
// Matches the backfill script's own choice of default for the same "we never
// collected this from old pharmacies" case. Keep this even after the backfill
// runs: it is what stops one un-migrated row from locking a real user out.
const DEFAULT_AREA_TYPE = 'city';

function serializePharmacy(pharmacy) {
  if (!pharmacy) return null;
  return {
    id: pharmacy._id,
    nameAr: pharmacy.nameAr,
    nameEn: pharmacy.nameEn,
    ownerName: pharmacy.ownerName,
    address: pharmacy.address,
    city: pharmacy.city,
    areaType: pharmacy.areaType || DEFAULT_AREA_TYPE,
    phone: pharmacy.phone,
    verificationPhoto: pharmacy.verificationPhoto,
  };
}

function serializeWarehouse(warehouse) {
  if (!warehouse) return null;
  return {
    id: warehouse._id,
    nameAr: warehouse.nameAr,
    nameEn: warehouse.nameEn,
    city: warehouse.city,
    phone: warehouse.phone,
    logo: warehouse.logo,
  };
}

// `refreshToken` is only present on responses that actually start or renew
// a session (register / login / refresh); getMe has none to give, which is
// why toMeResponse is a separate shape rather than a flag on this one.
function toAuthResponse({ user, pharmacy, warehouse, token, refreshToken }) {
  return {
    token,
    refreshToken,
    user: serializeUser(user),
    pharmacy: serializePharmacy(pharmacy),
    warehouse: serializeWarehouse(warehouse),
  };
}

function toMeResponse({ user, pharmacy, warehouse }) {
  return {
    user: serializeUser(user),
    pharmacy: serializePharmacy(pharmacy),
    warehouse: serializeWarehouse(warehouse),
  };
}

module.exports = {
  toAuthResponse,
  toMeResponse,
  serializeUser,
  serializePharmacy,
  serializeWarehouse,
};
