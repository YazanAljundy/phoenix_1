const { Schema, model } = require('mongoose');

// The support/complaint lifecycle. `pending` -> a pharmacy just filed it and
// nobody has looked yet; `in_review` -> an admin has picked it up; `resolved`
// -> the admin answered and considers it done; `closed` -> archived, no more
// action expected. The admin is the only role that moves a complaint between
// states (Section 6) - the pharmacy and the warehouse are read-only on status.
// Read elsewhere as Complaint.schema.path('status').enumValues, same as
// return.model.js's status enum is.
const COMPLAINT_STATUSES = ['pending', 'in_review', 'resolved', 'closed'];

const complaintSchema = new Schema(
  {
    // Sequential, human-facing reference ("Complaint #N") shown on every
    // screen (Sections 1, 8, 9). Issued the same way orderNumber is - an
    // atomic $inc on the counters collection (see complaint.service.js).
    complaintNumber: { type: Number, required: true, unique: true },
    // Who filed it. `pharmacyId` mirrors return.model.js's ownership pattern;
    // `pharmacyUserId` is kept alongside it so the "your complaint got a
    // reply" notification (Section 11) can be routed without a second lookup.
    pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
    pharmacyUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Who it is against. All FOUR of the fields below are optional and are set
    // (or left null) by complaint.service.js according to the CONTEXT the
    // complaint was filed from - the client never picks a "complaint type":
    //
    //   general   (from Profile)        -> warehouseId = relatedOrderId = null
    //   warehouse (from a warehouse page)-> warehouseId set, relatedOrderId null
    //   order     (from order tracking)  -> relatedOrderId set; warehouseId,
    //                                       warehouseUserId and relatedOrderNumber
    //                                       are RESOLVED FROM THE ORDER, never
    //                                       trusted from the client.
    //
    // `warehouseUserId` rides along when a warehouse is involved for the same
    // reason `pharmacyUserId` does (the warehouse dashboard is fed per-user).
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    warehouseUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    // Set only for an order-context complaint. The service verifies the order
    // exists and belongs to this pharmacy, then stores its id (for deep-linking
    // to the order screen) and a number snapshot (for display even if the order
    // is later removed).
    relatedOrderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    relatedOrderNumber: { type: Number, default: null },
    // Optional free-text extra context ("تفاصيل إضافية اختيارية").
    extraDetails: { type: String, default: null, trim: true, maxlength: 2000 },
    status: { type: String, enum: COMPLAINT_STATUSES, default: 'pending' },
    // The admin's reply and who wrote it (Section 10). All three are set
    // together, once, when the admin responds.
    adminResponse: { type: String, default: null },
    respondedByAdminId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Section 7: the three ways a complaint list is actually built, each filtered
// on one field and sorted newest-first. The lists paginate on `_id`
// descending - an ObjectId embeds its creation time, so `_id` desc IS
// "newest first" (same reasoning documented in adminOffer.service.js and used
// by return.model.js). Each index is therefore { filterField, _id } so one
// index scan covers both the equality match AND the ordered `_id < cursor`
// walk, with no separate sort stage:
//  - the pharmacy's "my complaints" list  -> { pharmacyId, _id }
//  - the warehouse's "against me" list     -> { warehouseId, _id }  (general
//        complaints have warehouseId=null and simply never match this filter)
//  - the admin queue, filtered by status   -> { status, _id }
//  - "complaints for this order" on the     -> { relatedOrderId, _id }
//        order-tracking screen (Section 9)
// The admin's unfiltered queue sorts on the built-in `_id` index directly.
// Verified with .explain(): every list query is an IXSCAN with no SORT stage.
complaintSchema.index({ pharmacyId: 1, _id: -1 });
complaintSchema.index({ warehouseId: 1, _id: -1 });
complaintSchema.index({ status: 1, _id: -1 });
complaintSchema.index({ relatedOrderId: 1, _id: -1 });

module.exports = model('Complaint', complaintSchema);
