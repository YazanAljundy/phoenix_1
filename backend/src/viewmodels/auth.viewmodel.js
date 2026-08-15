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

function serializePharmacy(pharmacy) {
  if (!pharmacy) return null;
  return {
    id: pharmacy._id,
    nameAr: pharmacy.nameAr,
    nameEn: pharmacy.nameEn,
    ownerName: pharmacy.ownerName,
    address: pharmacy.address,
    city: pharmacy.city,
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

function toAuthResponse({ user, pharmacy, warehouse, token }) {
  return {
    token,
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
