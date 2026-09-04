// The complaint payload shapes, one per audience. All three build on the same
// `base` so the pharmacy app, the warehouse panel and the admin panel parse a
// complaint the same way - only the attached context (which warehouse / which
// pharmacy / the admin responder) differs.

function serializeWarehouseRef(warehouse) {
  if (!warehouse) return null;
  return {
    id: warehouse._id,
    nameAr: warehouse.nameAr,
    nameEn: warehouse.nameEn,
    phone: warehouse.phone,
    city: warehouse.city,
    address: warehouse.address,
    logo: warehouse.logo ?? null,
  };
}

function serializePharmacyRef(pharmacy) {
  if (!pharmacy) return null;
  return {
    id: pharmacy._id,
    nameAr: pharmacy.nameAr,
    nameEn: pharmacy.nameEn,
    phone: pharmacy.phone,
    city: pharmacy.city,
    address: pharmacy.address,
    ownerName: pharmacy.ownerName,
  };
}

function serializeResponder(responder) {
  if (!responder) return null;
  return { id: responder._id, name: responder.name };
}

// Derived, not stored: the context a complaint was filed from is exactly
// determined by which of warehouseId / relatedOrderId are set. Every client
// (pharmacy app, warehouse panel, admin panel) reads this instead of
// re-deriving the same rule.
function contextTypeOf(complaint) {
  if (complaint.relatedOrderId) return 'order';
  if (complaint.warehouseId) return 'warehouse';
  return 'general';
}

function base(complaint) {
  return {
    id: complaint._id,
    complaintNumber: complaint.complaintNumber,
    contextType: contextTypeOf(complaint),
    subject: complaint.subject,
    description: complaint.description,
    extraDetails: complaint.extraDetails ?? null,
    status: complaint.status,
    relatedOrderId: complaint.relatedOrderId ?? null,
    relatedOrderNumber: complaint.relatedOrderNumber ?? null,
    adminResponse: complaint.adminResponse ?? null,
    respondedAt: complaint.respondedAt ?? null,
    createdAt: complaint.createdAt,
    updatedAt: complaint.updatedAt,
  };
}

// --- Pharmacy app (Sections 1-2) ------------------------------------------
function serializeForPharmacy({ complaint, warehouse, responder }) {
  return {
    ...base(complaint),
    warehouse: serializeWarehouseRef(warehouse),
    respondedBy: serializeResponder(responder),
  };
}

function toPharmacyComplaintResponse(row) {
  return { complaint: serializeForPharmacy(row) };
}

function toPharmacyComplaintListResponse(rows) {
  return { complaints: rows.map(serializeForPharmacy) };
}

// --- Warehouse panel (Section 3) -----------------------------------------
function serializeForWarehouse({ complaint, pharmacy, relatedOrder, responder }) {
  return {
    ...base(complaint),
    relatedOrderNumber: relatedOrder ? relatedOrder.orderNumber : complaint.relatedOrderNumber ?? null,
    pharmacy: serializePharmacyRef(pharmacy),
    respondedBy: serializeResponder(responder),
  };
}

function toWarehouseComplaintResponse(row) {
  return { complaint: serializeForWarehouse(row) };
}

function toWarehouseComplaintListResponse(rows) {
  return { complaints: rows.map(serializeForWarehouse) };
}

// --- Admin panel (Sections 8-10) ---------------------------------------
function serializeForAdmin({ complaint, warehouse, pharmacy, relatedOrder, responder }) {
  return {
    ...base(complaint),
    relatedOrderNumber: relatedOrder ? relatedOrder.orderNumber : complaint.relatedOrderNumber ?? null,
    // Section: optional delivery seal photo - surfaced to the admin only, and
    // only for an order-context complaint whose order actually has one. null
    // everywhere else.
    relatedOrderSealPhoto: relatedOrder?.deliverySealPhoto ?? null,
    relatedOrderSealConfirmedAt: relatedOrder?.deliverySealConfirmedAt ?? null,
    warehouse: serializeWarehouseRef(warehouse),
    pharmacy: serializePharmacyRef(pharmacy),
    respondedBy: serializeResponder(responder),
  };
}

function toAdminComplaintResponse(row) {
  return { complaint: serializeForAdmin(row) };
}

function toAdminComplaintListResponse(rows, counts) {
  return { complaints: rows.map(serializeForAdmin), counts };
}

module.exports = {
  toPharmacyComplaintResponse,
  toPharmacyComplaintListResponse,
  toWarehouseComplaintResponse,
  toWarehouseComplaintListResponse,
  toAdminComplaintResponse,
  toAdminComplaintListResponse,
};
