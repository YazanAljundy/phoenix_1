// The moderation view: everything the warehouse's own serializer emits, plus
// which warehouse it came from. Same allow-list convention as
// adminOffer.viewmodel.js.
const { serializeAdvertisement } = require('./warehouseAdvertisement.viewmodel');

function serializePendingAdvertisement({ advertisement, productById, warehouse }) {
  return {
    ...serializeAdvertisement(advertisement, productById),
    warehouseNameAr: warehouse ? warehouse.nameAr : null,
    warehouseNameEn: warehouse ? warehouse.nameEn : null,
  };
}

function toPendingAdvertisementsResponse(rows) {
  return { advertisements: rows.map(serializePendingAdvertisement) };
}

module.exports = { toPendingAdvertisementsResponse };
