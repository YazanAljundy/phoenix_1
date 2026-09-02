import 'package:phoenix/features/complaints/data/models/complaint_model.dart';

// Section 17: the "submit a complaint" screen is context-aware, not
// form-driven. The screen that opens it passes one of these - the user never
// picks a "complaint type". The display fields (warehouseName / orderNumber)
// are the same values the originating screen already loaded; they are shown
// for context only and the backend re-resolves everything from the id.
class SubmitComplaintArgs {
  const SubmitComplaintArgs.general()
    : warehouseId = null,
      warehouseName = null,
      orderId = null,
      orderNumber = null,
      orderWarehouseName = null;

  const SubmitComplaintArgs.warehouse({
    required this.warehouseId,
    required this.warehouseName,
  }) : orderId = null,
       orderNumber = null,
       orderWarehouseName = null;

  const SubmitComplaintArgs.order({
    required this.orderId,
    required this.orderNumber,
    this.orderWarehouseName,
  }) : warehouseId = null,
       warehouseName = null;

  final String? warehouseId;
  final String? warehouseName;
  final String? orderId;
  final int? orderNumber;
  final String? orderWarehouseName;

  ComplaintContext get context {
    if (orderId != null) return ComplaintContext.order;
    if (warehouseId != null) return ComplaintContext.warehouse;
    return ComplaintContext.general;
  }
}
