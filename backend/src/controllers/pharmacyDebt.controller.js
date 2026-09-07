const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Pharmacy = require('../models/pharmacy.model');
const Order = require('../models/order.model');
const statementService = require('../services/accountStatement.service');
const statementViewModel = require('../viewmodels/accountStatement.viewmodel');
const orderLedger = require('../services/orderLedger.service');
const invoiceViewModel = require('../viewmodels/invoice.viewmodel');

// Money-Flow V2. Read-only throughout - the pharmacy has no endpoint that
// moves money, and never has. What changed is the source: these now read the
// immutable ledger rather than V1's PharmacyBalance cache, so the figures a
// pharmacy sees are the same ones the warehouse sees, on the same basis.

async function loadPharmacyOrThrow(userId) {
  const pharmacy = await Pharmacy.findOne({ userId }).select('_id').lean();
  if (!pharmacy) {
    throw ApiError.notFound('Pharmacy profile not found.', 'PHARMACY_NOT_FOUND');
  }
  return pharmacy;
}

// Every warehouse this pharmacy has an account with, plus the three headline
// figures. V1 returned only the accounts in debt and let the client sum them,
// which silently hid every credit balance.
const list = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const summary = await statementService.getPharmacyAccountsSummary(pharmacy._id);
  res.json({ success: true, ...statementViewModel.toPharmacyAccountsResponse(summary) });
});

// The chronological statement for one warehouse relationship.
const statement = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const data = await statementService.getStatement({
    pharmacyId: pharmacy._id,
    warehouseId: req.params.warehouseId,
    from: req.query.from,
    to: req.query.to,
  });
  res.json({ success: true, ...statementViewModel.toStatementResponse(data, 'pharmacy') });
});

// The invoice for one of this pharmacy's own delivered orders. IDOR guard:
// scoped to pharmacyId, same pattern as every other order read.
const invoice = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const order = await Order.findOne({ _id: req.params.orderId, pharmacyId: pharmacy._id });
  if (!order) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  if (!order.invoiceNumber) {
    throw ApiError.badRequest(
      'This order has not been delivered yet, so it has no invoice.',
      undefined,
      'ORDER_NOT_INVOICED'
    );
  }
  const data = await orderLedger.buildInvoice(order);
  res.json({ success: true, ...invoiceViewModel.toInvoiceResponse(data, 'pharmacy') });
});

module.exports = { list, statement, invoice };
