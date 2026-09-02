// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'Phoenix';

  @override
  String get login => 'Login';

  @override
  String get logout => 'Logout';

  @override
  String get email => 'Email';

  @override
  String get password => 'Password';

  @override
  String get settings => 'Settings';

  @override
  String get language => 'Language';

  @override
  String get theme => 'Theme';

  @override
  String get light => 'Light';

  @override
  String get dark => 'Dark';

  @override
  String get system => 'System';

  @override
  String get save => 'Save';

  @override
  String get cancel => 'Cancel';

  @override
  String get welcome => 'Welcome';

  @override
  String get home => 'Home';

  @override
  String get profile => 'Profile';

  @override
  String get registrationTitle => 'Create your pharmacy account';

  @override
  String get registrationSubtitle =>
      'Fill in the details below - your account is activated once the administration reviews your documents.';

  @override
  String get fullNameLabel => 'Full name';

  @override
  String get fullNameHint => 'e.g. Dr. Samer Halabi';

  @override
  String get pharmacyNameLabel => 'Pharmacy name';

  @override
  String get pharmacyNameHint => 'e.g. Al-Noor Pharmacy';

  @override
  String get phoneLabel => 'Phone number';

  @override
  String get addressLabel => 'Address';

  @override
  String get pickLocationHint =>
      'Move the map to fine-tune the pin\'s position';

  @override
  String get resolvingAddressText => 'Resolving address...';

  @override
  String get locationPermissionDeniedMessage =>
      'Couldn\'t access your location - you can still drag the map manually.';

  @override
  String get addressNotResolvedYetMessage =>
      'Please wait for the map to resolve an address, or adjust the pin\'s position.';

  @override
  String get useCurrentLocationTooltip => 'My current location';

  @override
  String get confirmPasswordLabel => 'Confirm password';

  @override
  String get confirmPasswordHint => 'Re-enter your password';

  @override
  String passwordHint(String min) {
    return 'At least $min characters';
  }

  @override
  String get passwordTooShort => 'Password must be at least 6 characters.';

  @override
  String get passwordMismatch => 'Passwords do not match.';

  @override
  String get alreadyHaveAccountLink =>
      'Already have an account? Log in with password';

  @override
  String get sendCodeButton => 'Send verification code';

  @override
  String get createAccountButton => 'Create account';

  @override
  String get termsAgreementLabel =>
      'I agree to the Terms of Use and Privacy Policy.';

  @override
  String get termsAgreementRequiredError =>
      'You must agree to the terms to continue.';

  @override
  String get passwordsMustMatchHint => 'Both passwords must match.';

  @override
  String get passwordLoginTitle => 'Log in with password';

  @override
  String get passwordLoginSubtitle => 'Enter your phone number and password';

  @override
  String get backToRegistrationLink => 'New here? Create an account';

  @override
  String get otpTitle => 'Enter verification code';

  @override
  String get otpInstructionsPrefix => 'Enter the 6-digit code sent to';

  @override
  String get otpCodeLabel => 'Verification code';

  @override
  String get verifyButton => 'Verify';

  @override
  String get resendCodeButton => 'Didn\'t get the code? Resend';

  @override
  String get codeResent => 'A new code has been sent.';

  @override
  String get approvalPendingTitle => 'Your account is under review';

  @override
  String get approvalPendingMessage =>
      'We\'re reviewing your registration. You\'ll be able to order as soon as it\'s approved.';

  @override
  String approvalPendingMessageWithName(String pharmacyName) {
    return 'We\'re currently reviewing $pharmacyName\'s documents. You\'ll be able to order as soon as it\'s approved.';
  }

  @override
  String get approvalPendingBlockedTitle => 'Account blocked';

  @override
  String get approvalPendingBlockedMessage =>
      'This account has been blocked. Please contact support for help.';

  @override
  String get approvalChecklistReceived => 'Data and documents received';

  @override
  String get approvalChecklistReview => 'Under administration review';

  @override
  String get approvalChecklistActivate => 'Account activation and ordering';

  @override
  String get refreshStatusButton => 'Check status';

  @override
  String get contactSupportButton => 'Contact support';

  @override
  String get contactSupportDialogTitle => 'Contact support';

  @override
  String get contactSupportDialogMessage =>
      'For help with your account, please contact Al-Najah Warehouse support.';

  @override
  String get fieldRequired => 'This field is required.';

  @override
  String get invalidPhoneNumber => 'Please enter a valid phone number.';

  @override
  String get invalidOtpCode => 'Please enter the 6-digit code.';

  @override
  String get close => 'Close';

  @override
  String get errorState => 'Something went wrong.';

  @override
  String get errorNetwork =>
      'Unable to connect to the internet. Check your connection and try again.';

  @override
  String get errorTimeout =>
      'The request took longer than expected. Please try again.';

  @override
  String get errorServer => 'A server error occurred. Please try again later.';

  @override
  String get errorNotFound => 'The requested data could not be found.';

  @override
  String get errorSessionExpired =>
      'Your session has expired. Please sign in again.';

  @override
  String get errorNoPermission =>
      'You don\'t have permission to perform this action.';

  @override
  String get noMoreResultsText => 'No more results';

  @override
  String get retryButton => 'Retry';

  @override
  String get warehouseSelectionTitle => 'Choose a warehouse';

  @override
  String get selectWarehouseButton => 'Select';

  @override
  String get noWarehousesAvailable => 'No warehouses available yet.';

  @override
  String warehouseSelectedMessage(String name) {
    return '$name selected. The product catalog is coming soon.';
  }

  @override
  String warehousesAvailableSubtitle(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count warehouses available for your pharmacy',
      one: '1 warehouse available for your pharmacy',
      zero: 'No warehouses available for your pharmacy',
    );
    return '$_temp0';
  }

  @override
  String get searchWarehouseHint => 'Search by warehouse or city';

  @override
  String get noSearchResultsFound => 'No results match your search.';

  @override
  String get warehouseProfileButtonLabel => 'Profile';

  @override
  String get noManufacturersFound =>
      'No manufacturers available for this warehouse.';

  @override
  String manufacturersCountSubtitle(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count manufacturers',
      one: '1 manufacturer',
      zero: 'No manufacturers',
    );
    return '$_temp0';
  }

  @override
  String get warehouseProfileTooltip => 'Warehouse info';

  @override
  String get deliveryInfoTitle => 'Delivery Information';

  @override
  String deliveryHoursValue(String start, String end) {
    return 'From $start to $end';
  }

  @override
  String get deliveryHoursNotSet => 'Not specified';

  @override
  String get deliveryTypeSelfLabel => 'Delivered by the warehouse itself';

  @override
  String get deliveryTypeThirdPartyLabel =>
      'Delivered by a third-party courier';

  @override
  String get deliveryInfoDisclaimer =>
      'This information is for display only and doesn\'t prevent placing an order.';

  @override
  String get warehouseReviewsTitle => 'Reviews';

  @override
  String get noWarehouseReviewsYet => 'No reviews yet.';

  @override
  String get anonymousReviewerName => 'User';

  @override
  String get browseWarehouseProductsButton =>
      'Browse this warehouse\'s products';

  @override
  String get searchProductsHint => 'Search by name or manufacturer';

  @override
  String get addToCartButton => 'Add';

  @override
  String get unavailableLabel => 'Unavailable';

  @override
  String get offerBadgeLabel => 'Offer';

  @override
  String get toggleDensityTooltip => 'Toggle view';

  @override
  String get noProductsFound => 'No products found.';

  @override
  String catalogItemsCountSubtitle(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count items',
      one: '1 item',
      zero: 'No items',
    );
    return '$_temp0';
  }

  @override
  String get currencySuffix => 'SYP';

  @override
  String addedToCartMessage(String name) {
    return '$name added to cart.';
  }

  @override
  String get cartTitle => 'Cart';

  @override
  String get cartEmptyMessage => 'Your cart is empty.';

  @override
  String get cartEmptyHint =>
      'Choose a warehouse and start adding medicines to your cart.';

  @override
  String get browseCatalogButton => 'Browse products';

  @override
  String get quantityLabel => 'Quantity';

  @override
  String get decreaseQuantityLabel => 'Decrease quantity';

  @override
  String get increaseQuantityLabel => 'Increase quantity';

  @override
  String get notesLabel => 'Notes (optional)';

  @override
  String get subtotalLabel => 'Subtotal';

  @override
  String get submitOrderButton => 'Submit order';

  @override
  String get submitOrderTitle => 'Submit order?';

  @override
  String submitOrderConfirmation(String warehouseName) {
    return 'Send this order to $warehouseName?';
  }

  @override
  String get orderSubmittedTitle => 'Order submitted';

  @override
  String orderSubmittedMessage(String orderNumber) {
    return 'Your order #$orderNumber has been submitted.';
  }

  @override
  String get removeItemTitle => 'Remove item?';

  @override
  String removeItemConfirmation(String name) {
    return 'Remove $name from your cart?';
  }

  @override
  String get removeButton => 'Remove';

  @override
  String get cartConflictTitle => 'Start a new cart?';

  @override
  String cartConflictMessage(String name) {
    return 'Your cart has items from $name. Adding this item will clear it and start a new order.';
  }

  @override
  String get cartConflictConfirmButton => 'Start new cart';

  @override
  String get cartIconTooltip => 'Cart';

  @override
  String get reorderButton => 'Reorder';

  @override
  String get addProductButton => 'Add product';

  @override
  String get reorderReplaceCartTitle => 'Replace your cart?';

  @override
  String get reorderReplaceCartMessage =>
      'Your current cart will be replaced with the items from this order. You can still edit everything before checkout.';

  @override
  String get reorderReplaceCartConfirm => 'Replace cart';

  @override
  String get reorderUnavailableTitle => 'Some items are unavailable';

  @override
  String get reorderNoItemsMessage =>
      'None of this order\'s products are available from this warehouse anymore.';

  @override
  String reorderSomeItemsUnavailable(String names) {
    return 'These items are no longer sold by this warehouse and were not added: $names';
  }

  @override
  String get notificationsTitle => 'Notifications';

  @override
  String get noNotificationsYet => 'No notifications yet';

  @override
  String get noNotificationsYetHint =>
      'Order updates and offers will show up here.';

  @override
  String get markAllAsRead => 'Mark all as read';

  @override
  String get errorInvalidRequest =>
      'Something about this request wasn\'t valid. Please try again.';

  @override
  String get errorPharmacyNotFound =>
      'We couldn\'t find your pharmacy profile. Please contact support.';

  @override
  String get errorWarehouseNotFound => 'This warehouse is no longer available.';

  @override
  String get errorExchangeRateUnavailable =>
      'Prices can\'t be confirmed right now. Please try again shortly.';

  @override
  String get errorStockCheckFailedGeneric =>
      'Some items in your cart are no longer available as requested.';

  @override
  String errorProductUnavailable(String name) {
    return '$name is currently unavailable.';
  }

  @override
  String errorProductNotFound(String name) {
    return '$name is no longer available.';
  }

  @override
  String get thisItemFallback => 'This item';

  @override
  String get loading => 'Loading...';

  @override
  String get orderTrackingTitle => 'Order Tracking';

  @override
  String orderNumberLabel(String number) {
    return 'Order #$number';
  }

  @override
  String get stageSent => 'Sent';

  @override
  String get stageUnderReview => 'Waiting for Approval';

  @override
  String get stagePreparing => 'Preparing';

  @override
  String get stageOutForDelivery => 'On the Way';

  @override
  String get stageDelivered => 'Delivered';

  @override
  String get stageCancelled => 'Cancelled';

  @override
  String get stageModified => 'Order modified';

  @override
  String get stageUnderReviewDesc => 'Your order has reached the warehouse';

  @override
  String get stagePreparingDesc => 'The warehouse is preparing your order';

  @override
  String get stageOutForDeliveryDesc => 'Your order has left the warehouse';

  @override
  String get stageDeliveredDesc => 'You received the order';

  @override
  String get statusHistoryTitle => 'Status history';

  @override
  String lastUpdatedLabel(String time) {
    return 'Last updated: $time';
  }

  @override
  String get cancelOrderTitle => 'Cancel order?';

  @override
  String get cancelOrderConfirmation =>
      'Are you sure you want to cancel this order?';

  @override
  String get cancelOrderButton => 'Cancel order';

  @override
  String get orderCancelledMessage => 'This order has been cancelled.';

  @override
  String get contactWarehouseForChanges =>
      'For any changes now, please contact the warehouse directly.';

  @override
  String get orderModifiedBannerTitle =>
      'This order was modified by the warehouse';

  @override
  String get errorOrderNotFound => 'This order could not be found.';

  @override
  String get errorOrderNotCancellable =>
      'This order can no longer be cancelled from the app.';

  @override
  String get myOrdersTitle => 'My Orders';

  @override
  String myOrdersCountSubtitle(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count orders · pull down to refresh',
      one: '1 order · pull down to refresh',
      zero: 'No orders yet',
    );
    return '$_temp0';
  }

  @override
  String get refreshTooltip => 'Refresh';

  @override
  String get noOrdersYet => 'You haven\'t placed any orders yet.';

  @override
  String get browseWarehousesButton => 'Browse warehouses';

  @override
  String get invoiceTitle => 'Order items';

  @override
  String get discountLabel => 'Discount';

  @override
  String get invoiceTotalLabel => 'Total';

  @override
  String youSavedLabel(String amount) {
    return '💰 You saved $amount';
  }

  @override
  String totalSavingsLabel(String amount) {
    return '💰 Total savings: $amount (including offer discounts and manufacturer discount)';
  }

  @override
  String get returnsTitle => 'Returns';

  @override
  String returnsCountSubtitle(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count return requests',
      one: '1 return request',
      zero: 'No return requests',
    );
    return '$_temp0';
  }

  @override
  String get noReturnsYet => 'You haven\'t requested any returns yet.';

  @override
  String get newReturnRequestButton => 'New return request';

  @override
  String get selectOrderForReturnTitle =>
      'Select the order you want to return items from';

  @override
  String get noEligibleOrdersForReturn =>
      'No delivered orders are currently eligible for a return.';

  @override
  String get requestReturnTitle => 'Request a return';

  @override
  String get requestReturnButton => 'Submit return request';

  @override
  String get returnQuantityLabel => 'Quantity';

  @override
  String get returnReasonLabel => 'Reason';

  @override
  String get reasonDamaged => 'Damaged';

  @override
  String get reasonWrongItem => 'Wrong item';

  @override
  String get reasonOther => 'Other';

  @override
  String get multipleReasonsLabel => 'Multiple reasons';

  @override
  String get customReasonLabel => 'Please specify';

  @override
  String get returnSubmittedTitle => 'Return requested';

  @override
  String get returnSubmittedMessage =>
      'Your return request has been submitted. The warehouse will review it.';

  @override
  String get returnStatusPending => 'Pending review';

  @override
  String get returnStatusApproved => 'Approved';

  @override
  String get returnStatusRejected => 'Rejected';

  @override
  String get returnPickItemsLabel => 'Select the items you\'re returning';

  @override
  String get returnRejectionNoteLabel => 'Rejection reason';

  @override
  String get viewReplacementOrderButton => 'View replacement order';

  @override
  String get editButton => 'Edit';

  @override
  String get deleteReturnButton => 'Delete';

  @override
  String get deleteReturnConfirmTitle => 'Delete return request?';

  @override
  String get deleteReturnConfirmMessage =>
      'Are you sure you want to delete this return request?';

  @override
  String get returnApprovedBanner =>
      'Return approved — a replacement order has been created';

  @override
  String get returnPendingReviewBanner =>
      'Return submitted, awaiting the warehouse\'s review';

  @override
  String get returnRejectedBanner => 'Return rejected';

  @override
  String get errorOrderNotDelivered => 'This order hasn\'t been delivered yet.';

  @override
  String get errorOrderNotReorderable =>
      'Only delivered orders can be reordered.';

  @override
  String get errorOrderItemNotFound =>
      'This item could not be found in the order.';

  @override
  String get errorReturnQuantityExceeded =>
      'The return quantity exceeds what\'s available to return for this item.';

  @override
  String get errorCustomReasonRequired =>
      'Please describe the reason for this return.';

  @override
  String get errorTooManyReturnPhotos => 'You can attach up to 5 photos.';

  @override
  String get errorInvalidReturnPhoto =>
      'One of the attached photos is not a valid image.';

  @override
  String get errorReturnAlreadyExists =>
      'A return request has already been submitted for this order.';

  @override
  String get errorReturnNotEditable =>
      'This return request has already been decided and can no longer be changed.';

  @override
  String get errorReturnItemsEmpty =>
      'Please select at least one item to return.';

  @override
  String get errorReturnPhotoRequired =>
      'Please attach at least one photo of the item.';

  @override
  String get errorDuplicateReturnItem =>
      'Each item can only appear once in a return request.';

  @override
  String get errorRejectionNoteRequired =>
      'Please explain why this return is being rejected.';

  @override
  String get returnPhotosLabel => 'Photos (required)';

  @override
  String get returnPhotosHint =>
      'Add photos of the item to help the warehouse verify the reason';

  @override
  String get addPhotoButton => 'Add photo';

  @override
  String get cameraOption => 'Take a photo';

  @override
  String get galleryOption => 'Choose from gallery';

  @override
  String get permissionRequiredTitle => 'Permission needed';

  @override
  String get cameraPermissionDenied =>
      'Camera access is needed to take a photo. You can enable it in Settings.';

  @override
  String get openSettings => 'Open Settings';

  @override
  String get navWarehouses => 'Warehouses';

  @override
  String get profileTitle => 'Profile';

  @override
  String get personalInfoTitle => 'Personal information';

  @override
  String get cityLabel => 'City';

  @override
  String get logoutConfirmTitle => 'Log out?';

  @override
  String get logoutConfirmMessage => 'Are you sure you want to log out?';

  @override
  String get yourRatingTitle => 'Your rating';

  @override
  String get noRatingsYet => 'No warehouse has rated you yet.';

  @override
  String ratingSummary(String average, String count) {
    return '$average average ($count ratings)';
  }

  @override
  String get myDebtsTitle => 'My Debts';

  @override
  String get noDebtsYet => 'No debts right now.';

  @override
  String get totalDebtsLabel => 'Total debts';

  @override
  String get totalOrdersLabel => 'Total orders';

  @override
  String get totalPaidLabel => 'Total paid';

  @override
  String get currentBalanceLabel => 'Current balance';

  @override
  String get creditBalanceLabel => 'Credit balance';

  @override
  String get deliveredOrdersTitle => 'Delivered orders';

  @override
  String get paymentsTitle => 'Payments';

  @override
  String get noPaymentsYet => 'No payments recorded yet.';

  @override
  String get rateWarehouseTitle => 'Rate the warehouse';

  @override
  String get rateWarehouseCommentLabel => 'Comment (optional)';

  @override
  String get submitReviewButton => 'Submit rating';

  @override
  String get submitReviewConfirmTitle => 'Submit rating?';

  @override
  String get submitReviewConfirmMessage =>
      'You won\'t be able to change this rating after sending it. Continue?';

  @override
  String reviewThankYouTitle(String rating) {
    return 'Thanks — you rated this order $rating stars';
  }

  @override
  String get errorAlreadyReviewed => 'This order has already been rated.';

  @override
  String minOrderLabel(String amount) {
    return 'Minimum order: \$$amount';
  }

  @override
  String maxOrderLabel(String amount) {
    return 'Maximum order: \$$amount';
  }

  @override
  String addMoreToReachMinimum(String amount) {
    return 'Add \$$amount more to reach the minimum';
  }

  @override
  String removeToMeetMaximum(String amount) {
    return 'Over the \$$amount maximum — remove some items';
  }

  @override
  String orderBelowMinimum(String amount) {
    return 'The minimum order from this warehouse is \$$amount.';
  }

  @override
  String orderAboveMaximum(String amount) {
    return 'The maximum order from this warehouse is \$$amount.';
  }

  @override
  String get returnableSectionTitle => '🔄 Orders eligible for return';

  @override
  String get returnableSectionSubtitle =>
      'You can request a return within 48 hours of delivery';

  @override
  String returnableOrderNumber(String number) {
    return 'Order #$number';
  }

  @override
  String returnableHoursLeft(String hours) {
    return '${hours}h left';
  }

  @override
  String get returnableEndingSoon => 'Ending soon';

  @override
  String get returnableRequestButton => 'Request a return';

  @override
  String returnableMoreItems(String count) {
    return '+$count more';
  }

  @override
  String get returnWindowExpired =>
      'A return must be requested within 48 hours of delivery.';

  @override
  String get privacyPolicy => 'Privacy Policy';

  @override
  String privacyPolicyLastUpdated(String date) {
    return 'Last updated: $date';
  }

  @override
  String get complaintsTitle => 'Complaints';

  @override
  String get complaintsProfileSubtitle =>
      'File a complaint about a warehouse and follow its status';

  @override
  String complaintsCountSubtitle(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count complaints',
      one: '1 complaint',
      zero: 'No complaints yet',
    );
    return '$_temp0';
  }

  @override
  String get noComplaintsYet => 'You haven\'t filed any complaints yet.';

  @override
  String get noComplaintsYetHint =>
      'If you run into a problem with a warehouse, you can file a complaint for the administration to review.';

  @override
  String get submitComplaintCta => 'Submit a complaint';

  @override
  String get submitComplaintTitle => 'Submit a complaint';

  @override
  String get submitComplaintButton => 'Submit complaint';

  @override
  String get complaintSubmittedMessage =>
      'Your complaint has been submitted. The administration will review it.';

  @override
  String get complaintWarehouseLabel => 'Warehouse';

  @override
  String get complaintWarehouseHint =>
      'Choose the warehouse this complaint is about';

  @override
  String get complaintSubjectLabel => 'Complaint subject';

  @override
  String get complaintSubjectHint => 'Summarize the issue in a short sentence';

  @override
  String get complaintDescriptionLabel => 'Complaint details';

  @override
  String get complaintDescriptionHint => 'Describe the problem in detail';

  @override
  String get complaintOrderNumberLabel => 'Related order number (optional)';

  @override
  String get complaintOrderNumberHint =>
      'Enter the order number if this complaint is about an order';

  @override
  String get complaintExtraDetailsLabel => 'Additional details (optional)';

  @override
  String get complaintExtraDetailsHint =>
      'Any other information that could help resolve the complaint';

  @override
  String get complaintFormFooterHint =>
      'Your warehouse\'s information is attached to the complaint automatically.';

  @override
  String get complaintDetailTitle => 'Complaint details';

  @override
  String get complaintYourComplaintTitle => 'Your complaint';

  @override
  String get complaintResponseTitle => 'Response';

  @override
  String complaintNumberLabel(String number) {
    return 'Complaint #$number';
  }

  @override
  String complaintFiledOnLabel(String date) {
    return 'Filed on $date';
  }

  @override
  String complaintRelatedOrderLabel(String number) {
    return 'Related order: #$number';
  }

  @override
  String get complaintAboutWarehouseLabel => 'About this warehouse';

  @override
  String get complaintHasResponseHint => 'Reply received';

  @override
  String get complaintNoResponseYet =>
      'The administration hasn\'t responded yet. You\'ll be notified when a reply arrives.';

  @override
  String get complaintAdminResponseLabel => 'Administration\'s response';

  @override
  String complaintRespondedOnLabel(String date) {
    return 'Responded on $date';
  }

  @override
  String complaintRespondedByLabel(String name) {
    return 'Responded by $name';
  }

  @override
  String get complaintStatusPending => 'Pending';

  @override
  String get complaintStatusInReview => 'In review';

  @override
  String get complaintStatusResolved => 'Resolved';

  @override
  String get complaintStatusClosed => 'Closed';

  @override
  String get errorComplaintWarehouseRequired =>
      'Please choose the warehouse this complaint is about.';

  @override
  String get errorComplaintSubjectRequired =>
      'Please enter a subject for the complaint.';

  @override
  String get errorComplaintDescriptionRequired =>
      'Please describe the complaint.';

  @override
  String get errorComplaintOrderNotFound =>
      'No order with that number was found for this warehouse.';

  @override
  String get errorComplaintTooLong =>
      'One of the fields is longer than allowed. Please shorten it.';

  @override
  String get errorComplaintNotFound => 'This complaint could not be found.';

  @override
  String get errorComplaintContextMismatch =>
      'This complaint can\'t be linked to that warehouse.';

  @override
  String get submitComplaintOnWarehouseTitle => 'Complaint about warehouse';

  @override
  String get submitComplaintAboutOrderTitle => 'Complaint about order';

  @override
  String get complaintContextGeneral => 'General complaint';

  @override
  String get complaintGeneralContextNote =>
      'This isn\'t about a specific warehouse or order.';

  @override
  String get complaintOnWarehouseLabel => 'Complaint about';

  @override
  String get complaintAboutOrderLabel => 'Complaint about order';

  @override
  String complaintOrderWarehouseLine(String name) {
    return 'Warehouse: $name';
  }

  @override
  String get submitComplaintOnWarehouseCta =>
      'File a complaint about this warehouse';

  @override
  String get submitComplaintAboutOrderCta =>
      'File a complaint about this order';

  @override
  String get orderComplaintsSectionTitle => 'Complaints about this order';

  @override
  String get orderComplaintsEmptyPrompt =>
      'Have a problem with this order? You can file a complaint and the administration will review it.';

  @override
  String get updateAvailable => 'New Update Available';

  @override
  String get updateAvailableMessage =>
      'A new version of Phoenix is available. Update now to get the latest features and improvements.';

  @override
  String get updateRequired => 'Mandatory Update';

  @override
  String get updateRequiredMessage =>
      'Your current version of Phoenix is no longer supported. Please update the application to continue.';

  @override
  String get updateNow => 'Update Now';

  @override
  String get later => 'Later';

  @override
  String get updateOpenStoreFailed =>
      'Unable to open Google Play. Please try again.';
}
