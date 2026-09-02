import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/generated/app_localizations.dart';

// Maps an error `code` - either a backend domain code (see
// backend/src/utils/ApiError.js) or one of [FailureCode] for a transport
// error the client raised itself - to a localized, user-facing string via
// the existing .arb/AppLocalizations system. Falls back to the raw English
// `fallbackMessage` only for a code this hasn't been taught yet (endpoints
// still on the message-only pattern, e.g. most of auth).
//
// This is the single place a technical error becomes a sentence the user
// sees. Pass the result to FailureWidget / a SnackBar - never a raw
// exception or Failure.errMessage.
//
// Cart's STOCK_CHECK_FAILED is deliberately not handled here: its per-item
// `details.problems` need product names the client already holds locally
// (see features/cart/presentation/utils/cart_error_translator.dart), which
// this generic single-string translator has no access to.
String translateErrorCode(AppLocalizations l10n, String? code, String fallbackMessage) {
  switch (code) {
    // --- Transport / HTTP-status failures (FailureCode + synthesised HTTP_*).
    case FailureCode.network:
      return l10n.errorNetwork;
    case FailureCode.timeout:
      return l10n.errorTimeout;
    case 'HTTP_401':
      return l10n.errorSessionExpired;
    case 'HTTP_403':
      return l10n.errorNoPermission;
    case 'HTTP_404':
      return l10n.errorNotFound;
    case 'HTTP_500':
    case 'HTTP_502':
    case 'HTTP_503':
      return l10n.errorServer;

    // --- Backend domain codes.
    case 'CART_EMPTY':
      return l10n.cartEmptyMessage;
    case 'INVALID_PRODUCT':
    case 'INVALID_QUANTITY':
    case 'INVALID_WAREHOUSE':
      return l10n.errorInvalidRequest;
    case 'PHARMACY_NOT_FOUND':
      return l10n.errorPharmacyNotFound;
    case 'WAREHOUSE_NOT_FOUND':
      return l10n.errorWarehouseNotFound;
    case 'EXCHANGE_RATE_UNAVAILABLE':
      return l10n.errorExchangeRateUnavailable;
    case 'STOCK_CHECK_FAILED':
      return l10n.errorStockCheckFailedGeneric;
    case 'ORDER_NOT_FOUND':
      return l10n.errorOrderNotFound;
    case 'ORDER_NOT_CANCELLABLE':
      return l10n.errorOrderNotCancellable;
    case 'ORDER_NOT_DELIVERED':
      return l10n.errorOrderNotDelivered;
    case 'ORDER_NOT_REORDERABLE':
      return l10n.errorOrderNotReorderable;
    case 'ORDER_ITEM_NOT_FOUND':
      return l10n.errorOrderItemNotFound;
    case 'RETURN_QUANTITY_EXCEEDS_ORDERED':
      return l10n.errorReturnQuantityExceeded;
    case 'INVALID_REASON_TYPE':
      return l10n.errorInvalidRequest;
    case 'CUSTOM_REASON_REQUIRED':
      return l10n.errorCustomReasonRequired;
    case 'TOO_MANY_RETURN_PHOTOS':
      return l10n.errorTooManyReturnPhotos;
    case 'INVALID_RETURN_PHOTO':
      return l10n.errorInvalidReturnPhoto;
    case 'RETURN_ALREADY_EXISTS':
      return l10n.errorReturnAlreadyExists;
    case 'RETURN_NOT_EDITABLE':
      return l10n.errorReturnNotEditable;
    case 'RETURN_ITEMS_EMPTY':
      return l10n.errorReturnItemsEmpty;
    case 'RETURN_PHOTO_REQUIRED':
      return l10n.errorReturnPhotoRequired;
    case 'DUPLICATE_RETURN_ITEM':
      return l10n.errorDuplicateReturnItem;
    case 'REJECTION_NOTE_REQUIRED':
      return l10n.errorRejectionNoteRequired;
    case 'RETURN_NOT_FOUND':
      return l10n.errorInvalidRequest;
    case 'INVALID_RATING':
      return l10n.errorInvalidRequest;
    case 'ALREADY_REVIEWED':
      return l10n.errorAlreadyReviewed;

    // --- Complaint system.
    case 'COMPLAINT_WAREHOUSE_REQUIRED':
    case 'COMPLAINT_INVALID_WAREHOUSE':
      return l10n.errorComplaintWarehouseRequired;
    case 'COMPLAINT_SUBJECT_REQUIRED':
      return l10n.errorComplaintSubjectRequired;
    case 'COMPLAINT_DESCRIPTION_REQUIRED':
      return l10n.errorComplaintDescriptionRequired;
    case 'COMPLAINT_INVALID_ORDER':
    case 'COMPLAINT_ORDER_NOT_FOUND':
      return l10n.errorComplaintOrderNotFound;
    case 'COMPLAINT_CONTEXT_MISMATCH':
      return l10n.errorComplaintContextMismatch;
    case 'COMPLAINT_SUBJECT_REQUIRED_TOO_LONG':
    case 'COMPLAINT_DESCRIPTION_REQUIRED_TOO_LONG':
    case 'COMPLAINT_EXTRA_TOO_LONG':
      return l10n.errorComplaintTooLong;
    case 'COMPLAINT_NOT_FOUND':
      return l10n.errorComplaintNotFound;

    case 'UNEXPECTED_ERROR':
      return l10n.errorState;
    default:
      return fallbackMessage;
  }
}
