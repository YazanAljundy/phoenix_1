import 'package:phoenix/generated/app_localizations.dart';

// Maps a backend error `code` (see backend/src/utils/ApiError.js) to a
// localized string via the existing .arb/AppLocalizations system. Falls back
// to the server's raw English `fallbackMessage` for any code this hasn't
// been taught yet - which is every code from an endpoint that hasn't been
// migrated to the code-based pattern (auth, catalog: still message-only by
// design, see the cart error-code migration this was introduced for).
//
// Cart's STOCK_CHECK_FAILED is deliberately not handled here: its per-item
// `details.problems` need product names the client already holds locally
// (see features/cart/presentation/utils/cart_error_translator.dart), which
// this generic single-string translator has no access to.
String translateErrorCode(AppLocalizations l10n, String? code, String fallbackMessage) {
  switch (code) {
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
    case 'UNEXPECTED_ERROR':
      return l10n.errorState;
    default:
      return fallbackMessage;
  }
}
