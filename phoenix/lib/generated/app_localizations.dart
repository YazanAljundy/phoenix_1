import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ar.dart';
import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en'),
  ];

  /// No description provided for @appName.
  ///
  /// In en, this message translates to:
  /// **'Phoenix'**
  String get appName;

  /// No description provided for @login.
  ///
  /// In en, this message translates to:
  /// **'Login'**
  String get login;

  /// No description provided for @logout.
  ///
  /// In en, this message translates to:
  /// **'Logout'**
  String get logout;

  /// No description provided for @email.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get email;

  /// No description provided for @password.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// No description provided for @settings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settings;

  /// No description provided for @language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// No description provided for @theme.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get theme;

  /// No description provided for @light.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get light;

  /// No description provided for @dark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get dark;

  /// No description provided for @system.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get system;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @welcome.
  ///
  /// In en, this message translates to:
  /// **'Welcome'**
  String get welcome;

  /// No description provided for @home.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get home;

  /// No description provided for @profile.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profile;

  /// No description provided for @registrationTitle.
  ///
  /// In en, this message translates to:
  /// **'Create your pharmacy account'**
  String get registrationTitle;

  /// No description provided for @registrationSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Fill in your details to get started'**
  String get registrationSubtitle;

  /// No description provided for @fullNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Full name'**
  String get fullNameLabel;

  /// No description provided for @pharmacyNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Pharmacy name'**
  String get pharmacyNameLabel;

  /// No description provided for @phoneLabel.
  ///
  /// In en, this message translates to:
  /// **'Phone number'**
  String get phoneLabel;

  /// No description provided for @addressLabel.
  ///
  /// In en, this message translates to:
  /// **'Address'**
  String get addressLabel;

  /// No description provided for @verificationPhotoLabel.
  ///
  /// In en, this message translates to:
  /// **'Pharmacy photo'**
  String get verificationPhotoLabel;

  /// No description provided for @verificationPhotoHint.
  ///
  /// In en, this message translates to:
  /// **'A photo of your pharmacy\'s storefront or sign'**
  String get verificationPhotoHint;

  /// No description provided for @choosePhotoButton.
  ///
  /// In en, this message translates to:
  /// **'Choose photo'**
  String get choosePhotoButton;

  /// No description provided for @changePhotoButton.
  ///
  /// In en, this message translates to:
  /// **'Change photo'**
  String get changePhotoButton;

  /// No description provided for @photoRequired.
  ///
  /// In en, this message translates to:
  /// **'Please add a photo of your pharmacy.'**
  String get photoRequired;

  /// No description provided for @confirmPasswordLabel.
  ///
  /// In en, this message translates to:
  /// **'Confirm password'**
  String get confirmPasswordLabel;

  /// No description provided for @passwordTooShort.
  ///
  /// In en, this message translates to:
  /// **'Password must be at least 6 characters.'**
  String get passwordTooShort;

  /// No description provided for @passwordMismatch.
  ///
  /// In en, this message translates to:
  /// **'Passwords do not match.'**
  String get passwordMismatch;

  /// No description provided for @alreadyHaveAccountLink.
  ///
  /// In en, this message translates to:
  /// **'Already have an account? Log in with password'**
  String get alreadyHaveAccountLink;

  /// No description provided for @sendCodeButton.
  ///
  /// In en, this message translates to:
  /// **'Send verification code'**
  String get sendCodeButton;

  /// No description provided for @createAccountButton.
  ///
  /// In en, this message translates to:
  /// **'Create account'**
  String get createAccountButton;

  /// No description provided for @passwordLoginTitle.
  ///
  /// In en, this message translates to:
  /// **'Log in with password'**
  String get passwordLoginTitle;

  /// No description provided for @passwordLoginSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Enter your phone number and password'**
  String get passwordLoginSubtitle;

  /// No description provided for @backToRegistrationLink.
  ///
  /// In en, this message translates to:
  /// **'New here? Create an account'**
  String get backToRegistrationLink;

  /// No description provided for @otpTitle.
  ///
  /// In en, this message translates to:
  /// **'Enter verification code'**
  String get otpTitle;

  /// No description provided for @otpInstructions.
  ///
  /// In en, this message translates to:
  /// **'We sent a 6-digit code by SMS to {phone}'**
  String otpInstructions(String phone);

  /// No description provided for @otpCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Verification code'**
  String get otpCodeLabel;

  /// No description provided for @verifyButton.
  ///
  /// In en, this message translates to:
  /// **'Verify'**
  String get verifyButton;

  /// No description provided for @resendCodeButton.
  ///
  /// In en, this message translates to:
  /// **'Resend code'**
  String get resendCodeButton;

  /// No description provided for @codeResent.
  ///
  /// In en, this message translates to:
  /// **'A new code has been sent.'**
  String get codeResent;

  /// No description provided for @approvalPendingTitle.
  ///
  /// In en, this message translates to:
  /// **'Your account is under review'**
  String get approvalPendingTitle;

  /// No description provided for @approvalPendingMessage.
  ///
  /// In en, this message translates to:
  /// **'We\'re reviewing your registration. You\'ll be able to order as soon as it\'s approved.'**
  String get approvalPendingMessage;

  /// No description provided for @approvalPendingBlockedTitle.
  ///
  /// In en, this message translates to:
  /// **'Account blocked'**
  String get approvalPendingBlockedTitle;

  /// No description provided for @approvalPendingBlockedMessage.
  ///
  /// In en, this message translates to:
  /// **'This account has been blocked. Please contact support for help.'**
  String get approvalPendingBlockedMessage;

  /// No description provided for @refreshStatusButton.
  ///
  /// In en, this message translates to:
  /// **'Check status'**
  String get refreshStatusButton;

  /// No description provided for @contactSupportButton.
  ///
  /// In en, this message translates to:
  /// **'Contact support'**
  String get contactSupportButton;

  /// No description provided for @contactSupportDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Contact support'**
  String get contactSupportDialogTitle;

  /// No description provided for @contactSupportDialogMessage.
  ///
  /// In en, this message translates to:
  /// **'For help with your account, please contact Al-Najah Warehouse support.'**
  String get contactSupportDialogMessage;

  /// No description provided for @fieldRequired.
  ///
  /// In en, this message translates to:
  /// **'This field is required.'**
  String get fieldRequired;

  /// No description provided for @invalidPhoneNumber.
  ///
  /// In en, this message translates to:
  /// **'Please enter a valid phone number.'**
  String get invalidPhoneNumber;

  /// No description provided for @invalidOtpCode.
  ///
  /// In en, this message translates to:
  /// **'Please enter the 6-digit code.'**
  String get invalidOtpCode;

  /// No description provided for @close.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get close;

  /// No description provided for @errorState.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong.'**
  String get errorState;

  /// No description provided for @warehouseSelectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Choose a warehouse'**
  String get warehouseSelectionTitle;

  /// No description provided for @selectWarehouseButton.
  ///
  /// In en, this message translates to:
  /// **'Select'**
  String get selectWarehouseButton;

  /// No description provided for @noWarehousesAvailable.
  ///
  /// In en, this message translates to:
  /// **'No warehouses available yet.'**
  String get noWarehousesAvailable;

  /// No description provided for @warehouseSelectedMessage.
  ///
  /// In en, this message translates to:
  /// **'{name} selected. The product catalog is coming soon.'**
  String warehouseSelectedMessage(String name);

  /// No description provided for @noManufacturersFound.
  ///
  /// In en, this message translates to:
  /// **'No manufacturers available for this warehouse.'**
  String get noManufacturersFound;

  /// No description provided for @warehouseProfileTooltip.
  ///
  /// In en, this message translates to:
  /// **'Warehouse info'**
  String get warehouseProfileTooltip;

  /// No description provided for @deliveryInfoTitle.
  ///
  /// In en, this message translates to:
  /// **'Delivery Information'**
  String get deliveryInfoTitle;

  /// No description provided for @deliveryHoursValue.
  ///
  /// In en, this message translates to:
  /// **'From {start} to {end}'**
  String deliveryHoursValue(String start, String end);

  /// No description provided for @deliveryHoursNotSet.
  ///
  /// In en, this message translates to:
  /// **'Not specified'**
  String get deliveryHoursNotSet;

  /// No description provided for @deliveryTypeSelfLabel.
  ///
  /// In en, this message translates to:
  /// **'Delivered by the warehouse itself'**
  String get deliveryTypeSelfLabel;

  /// No description provided for @deliveryTypeThirdPartyLabel.
  ///
  /// In en, this message translates to:
  /// **'Delivered by a third-party courier'**
  String get deliveryTypeThirdPartyLabel;

  /// No description provided for @deliveryInfoDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'This information is for display only and doesn\'t prevent placing an order.'**
  String get deliveryInfoDisclaimer;

  /// No description provided for @warehouseReviewsTitle.
  ///
  /// In en, this message translates to:
  /// **'Reviews'**
  String get warehouseReviewsTitle;

  /// No description provided for @noWarehouseReviewsYet.
  ///
  /// In en, this message translates to:
  /// **'No reviews yet.'**
  String get noWarehouseReviewsYet;

  /// No description provided for @browseWarehouseProductsButton.
  ///
  /// In en, this message translates to:
  /// **'Browse this warehouse\'s products'**
  String get browseWarehouseProductsButton;

  /// No description provided for @searchProductsHint.
  ///
  /// In en, this message translates to:
  /// **'Search by name or manufacturer'**
  String get searchProductsHint;

  /// No description provided for @allCategories.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get allCategories;

  /// No description provided for @addToCartButton.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get addToCartButton;

  /// No description provided for @unavailableLabel.
  ///
  /// In en, this message translates to:
  /// **'Unavailable'**
  String get unavailableLabel;

  /// No description provided for @noProductsFound.
  ///
  /// In en, this message translates to:
  /// **'No products found.'**
  String get noProductsFound;

  /// No description provided for @currencySuffix.
  ///
  /// In en, this message translates to:
  /// **'SYP'**
  String get currencySuffix;

  /// No description provided for @addedToCartMessage.
  ///
  /// In en, this message translates to:
  /// **'{name} added to cart.'**
  String addedToCartMessage(String name);

  /// No description provided for @cartTitle.
  ///
  /// In en, this message translates to:
  /// **'Cart'**
  String get cartTitle;

  /// No description provided for @cartEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'Your cart is empty.'**
  String get cartEmptyMessage;

  /// No description provided for @notesLabel.
  ///
  /// In en, this message translates to:
  /// **'Notes (optional)'**
  String get notesLabel;

  /// No description provided for @subtotalLabel.
  ///
  /// In en, this message translates to:
  /// **'Subtotal'**
  String get subtotalLabel;

  /// No description provided for @submitOrderButton.
  ///
  /// In en, this message translates to:
  /// **'Submit order'**
  String get submitOrderButton;

  /// No description provided for @submitOrderTitle.
  ///
  /// In en, this message translates to:
  /// **'Submit order?'**
  String get submitOrderTitle;

  /// No description provided for @submitOrderConfirmation.
  ///
  /// In en, this message translates to:
  /// **'Send this order to {warehouseName}?'**
  String submitOrderConfirmation(String warehouseName);

  /// No description provided for @orderSubmittedTitle.
  ///
  /// In en, this message translates to:
  /// **'Order submitted'**
  String get orderSubmittedTitle;

  /// No description provided for @orderSubmittedMessage.
  ///
  /// In en, this message translates to:
  /// **'Your order #{orderNumber} has been submitted.'**
  String orderSubmittedMessage(String orderNumber);

  /// No description provided for @removeItemTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove item?'**
  String get removeItemTitle;

  /// No description provided for @removeItemConfirmation.
  ///
  /// In en, this message translates to:
  /// **'Remove {name} from your cart?'**
  String removeItemConfirmation(String name);

  /// No description provided for @removeButton.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get removeButton;

  /// No description provided for @cartConflictTitle.
  ///
  /// In en, this message translates to:
  /// **'Start a new cart?'**
  String get cartConflictTitle;

  /// No description provided for @cartConflictMessage.
  ///
  /// In en, this message translates to:
  /// **'Your cart has items from {name}. Adding this item will clear it and start a new order.'**
  String cartConflictMessage(String name);

  /// No description provided for @cartConflictConfirmButton.
  ///
  /// In en, this message translates to:
  /// **'Start new cart'**
  String get cartConflictConfirmButton;

  /// No description provided for @cartIconTooltip.
  ///
  /// In en, this message translates to:
  /// **'Cart'**
  String get cartIconTooltip;

  /// No description provided for @errorInvalidRequest.
  ///
  /// In en, this message translates to:
  /// **'Something about this request wasn\'t valid. Please try again.'**
  String get errorInvalidRequest;

  /// No description provided for @errorPharmacyNotFound.
  ///
  /// In en, this message translates to:
  /// **'We couldn\'t find your pharmacy profile. Please contact support.'**
  String get errorPharmacyNotFound;

  /// No description provided for @errorWarehouseNotFound.
  ///
  /// In en, this message translates to:
  /// **'This warehouse is no longer available.'**
  String get errorWarehouseNotFound;

  /// No description provided for @errorExchangeRateUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Prices can\'t be confirmed right now. Please try again shortly.'**
  String get errorExchangeRateUnavailable;

  /// No description provided for @errorStockCheckFailedGeneric.
  ///
  /// In en, this message translates to:
  /// **'Some items in your cart are no longer available as requested.'**
  String get errorStockCheckFailedGeneric;

  /// No description provided for @errorProductUnavailable.
  ///
  /// In en, this message translates to:
  /// **'{name} is currently unavailable.'**
  String errorProductUnavailable(String name);

  /// No description provided for @errorProductNotFound.
  ///
  /// In en, this message translates to:
  /// **'{name} is no longer available.'**
  String errorProductNotFound(String name);

  /// No description provided for @thisItemFallback.
  ///
  /// In en, this message translates to:
  /// **'This item'**
  String get thisItemFallback;

  /// No description provided for @loading.
  ///
  /// In en, this message translates to:
  /// **'Loading...'**
  String get loading;

  /// No description provided for @orderTrackingTitle.
  ///
  /// In en, this message translates to:
  /// **'Order Tracking'**
  String get orderTrackingTitle;

  /// No description provided for @orderNumberLabel.
  ///
  /// In en, this message translates to:
  /// **'Order #{number}'**
  String orderNumberLabel(String number);

  /// No description provided for @stageSent.
  ///
  /// In en, this message translates to:
  /// **'Sent'**
  String get stageSent;

  /// No description provided for @stageUnderReview.
  ///
  /// In en, this message translates to:
  /// **'Under review'**
  String get stageUnderReview;

  /// No description provided for @stagePreparing.
  ///
  /// In en, this message translates to:
  /// **'Preparing'**
  String get stagePreparing;

  /// No description provided for @stageOutForDelivery.
  ///
  /// In en, this message translates to:
  /// **'Out for delivery'**
  String get stageOutForDelivery;

  /// No description provided for @stageDelivered.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get stageDelivered;

  /// No description provided for @stageCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get stageCancelled;

  /// No description provided for @statusHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'Status history'**
  String get statusHistoryTitle;

  /// No description provided for @cancelOrderTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel order?'**
  String get cancelOrderTitle;

  /// No description provided for @cancelOrderConfirmation.
  ///
  /// In en, this message translates to:
  /// **'Are you sure you want to cancel this order?'**
  String get cancelOrderConfirmation;

  /// No description provided for @cancelOrderButton.
  ///
  /// In en, this message translates to:
  /// **'Cancel order'**
  String get cancelOrderButton;

  /// No description provided for @orderCancelledMessage.
  ///
  /// In en, this message translates to:
  /// **'This order has been cancelled.'**
  String get orderCancelledMessage;

  /// No description provided for @contactWarehouseForChanges.
  ///
  /// In en, this message translates to:
  /// **'For any changes now, please contact the warehouse directly.'**
  String get contactWarehouseForChanges;

  /// No description provided for @errorOrderNotFound.
  ///
  /// In en, this message translates to:
  /// **'This order could not be found.'**
  String get errorOrderNotFound;

  /// No description provided for @errorOrderNotCancellable.
  ///
  /// In en, this message translates to:
  /// **'This order can no longer be cancelled from the app.'**
  String get errorOrderNotCancellable;

  /// No description provided for @myOrdersTitle.
  ///
  /// In en, this message translates to:
  /// **'My Orders'**
  String get myOrdersTitle;

  /// No description provided for @noOrdersYet.
  ///
  /// In en, this message translates to:
  /// **'You haven\'t placed any orders yet.'**
  String get noOrdersYet;

  /// No description provided for @invoiceTitle.
  ///
  /// In en, this message translates to:
  /// **'Order items'**
  String get invoiceTitle;

  /// No description provided for @discountLabel.
  ///
  /// In en, this message translates to:
  /// **'Discount'**
  String get discountLabel;

  /// No description provided for @invoiceTotalLabel.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get invoiceTotalLabel;

  /// No description provided for @youSavedLabel.
  ///
  /// In en, this message translates to:
  /// **'💰 You saved {amount}'**
  String youSavedLabel(String amount);

  /// No description provided for @totalSavingsLabel.
  ///
  /// In en, this message translates to:
  /// **'💰 Total savings: {amount} (including offer discounts and manufacturer discount)'**
  String totalSavingsLabel(String amount);

  /// No description provided for @returnsTitle.
  ///
  /// In en, this message translates to:
  /// **'Returns'**
  String get returnsTitle;

  /// No description provided for @noReturnsYet.
  ///
  /// In en, this message translates to:
  /// **'You haven\'t requested any returns yet.'**
  String get noReturnsYet;

  /// No description provided for @requestReturnTitle.
  ///
  /// In en, this message translates to:
  /// **'Request a return'**
  String get requestReturnTitle;

  /// No description provided for @requestReturnButton.
  ///
  /// In en, this message translates to:
  /// **'Submit return request'**
  String get requestReturnButton;

  /// No description provided for @returnQuantityLabel.
  ///
  /// In en, this message translates to:
  /// **'Quantity'**
  String get returnQuantityLabel;

  /// No description provided for @returnReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get returnReasonLabel;

  /// No description provided for @reasonDamaged.
  ///
  /// In en, this message translates to:
  /// **'Damaged'**
  String get reasonDamaged;

  /// No description provided for @reasonWrongItem.
  ///
  /// In en, this message translates to:
  /// **'Wrong item'**
  String get reasonWrongItem;

  /// No description provided for @reasonOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get reasonOther;

  /// No description provided for @customReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Please specify'**
  String get customReasonLabel;

  /// No description provided for @returnSubmittedTitle.
  ///
  /// In en, this message translates to:
  /// **'Return requested'**
  String get returnSubmittedTitle;

  /// No description provided for @returnSubmittedMessage.
  ///
  /// In en, this message translates to:
  /// **'Your return request has been submitted. The warehouse will review it.'**
  String get returnSubmittedMessage;

  /// No description provided for @returnStatusPending.
  ///
  /// In en, this message translates to:
  /// **'Pending review'**
  String get returnStatusPending;

  /// No description provided for @returnStatusApproved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get returnStatusApproved;

  /// No description provided for @returnStatusRejected.
  ///
  /// In en, this message translates to:
  /// **'Rejected'**
  String get returnStatusRejected;

  /// No description provided for @returnPickItemsLabel.
  ///
  /// In en, this message translates to:
  /// **'Select the items you\'re returning'**
  String get returnPickItemsLabel;

  /// No description provided for @returnRejectionNoteLabel.
  ///
  /// In en, this message translates to:
  /// **'Rejection reason'**
  String get returnRejectionNoteLabel;

  /// No description provided for @viewReplacementOrderButton.
  ///
  /// In en, this message translates to:
  /// **'View replacement order'**
  String get viewReplacementOrderButton;

  /// No description provided for @editButton.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get editButton;

  /// No description provided for @deleteReturnButton.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get deleteReturnButton;

  /// No description provided for @deleteReturnConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete return request?'**
  String get deleteReturnConfirmTitle;

  /// No description provided for @deleteReturnConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'Are you sure you want to delete this return request?'**
  String get deleteReturnConfirmMessage;

  /// No description provided for @returnApprovedBanner.
  ///
  /// In en, this message translates to:
  /// **'Return approved — a replacement order has been created'**
  String get returnApprovedBanner;

  /// No description provided for @returnPendingReviewBanner.
  ///
  /// In en, this message translates to:
  /// **'Return submitted, awaiting the warehouse\'s review'**
  String get returnPendingReviewBanner;

  /// No description provided for @returnRejectedBanner.
  ///
  /// In en, this message translates to:
  /// **'Return rejected'**
  String get returnRejectedBanner;

  /// No description provided for @errorOrderNotDelivered.
  ///
  /// In en, this message translates to:
  /// **'This order hasn\'t been delivered yet.'**
  String get errorOrderNotDelivered;

  /// No description provided for @errorOrderItemNotFound.
  ///
  /// In en, this message translates to:
  /// **'This item could not be found in the order.'**
  String get errorOrderItemNotFound;

  /// No description provided for @errorReturnQuantityExceeded.
  ///
  /// In en, this message translates to:
  /// **'The return quantity exceeds what\'s available to return for this item.'**
  String get errorReturnQuantityExceeded;

  /// No description provided for @errorCustomReasonRequired.
  ///
  /// In en, this message translates to:
  /// **'Please describe the reason for this return.'**
  String get errorCustomReasonRequired;

  /// No description provided for @errorTooManyReturnPhotos.
  ///
  /// In en, this message translates to:
  /// **'You can attach up to 5 photos.'**
  String get errorTooManyReturnPhotos;

  /// No description provided for @errorInvalidReturnPhoto.
  ///
  /// In en, this message translates to:
  /// **'One of the attached photos is not a valid image.'**
  String get errorInvalidReturnPhoto;

  /// No description provided for @errorReturnAlreadyExists.
  ///
  /// In en, this message translates to:
  /// **'A return request has already been submitted for this order.'**
  String get errorReturnAlreadyExists;

  /// No description provided for @errorReturnNotEditable.
  ///
  /// In en, this message translates to:
  /// **'This return request has already been decided and can no longer be changed.'**
  String get errorReturnNotEditable;

  /// No description provided for @errorReturnItemsEmpty.
  ///
  /// In en, this message translates to:
  /// **'Please select at least one item to return.'**
  String get errorReturnItemsEmpty;

  /// No description provided for @errorDuplicateReturnItem.
  ///
  /// In en, this message translates to:
  /// **'Each item can only appear once in a return request.'**
  String get errorDuplicateReturnItem;

  /// No description provided for @errorRejectionNoteRequired.
  ///
  /// In en, this message translates to:
  /// **'Please explain why this return is being rejected.'**
  String get errorRejectionNoteRequired;

  /// No description provided for @returnPhotosLabel.
  ///
  /// In en, this message translates to:
  /// **'Photos (optional)'**
  String get returnPhotosLabel;

  /// No description provided for @returnPhotosHint.
  ///
  /// In en, this message translates to:
  /// **'Add photos of the item to help the warehouse verify the reason'**
  String get returnPhotosHint;

  /// No description provided for @addPhotoButton.
  ///
  /// In en, this message translates to:
  /// **'Add photo'**
  String get addPhotoButton;

  /// No description provided for @navWarehouses.
  ///
  /// In en, this message translates to:
  /// **'Warehouses'**
  String get navWarehouses;

  /// No description provided for @profileTitle.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profileTitle;

  /// No description provided for @logoutConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Log out?'**
  String get logoutConfirmTitle;

  /// No description provided for @logoutConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'Are you sure you want to log out?'**
  String get logoutConfirmMessage;

  /// No description provided for @yourRatingTitle.
  ///
  /// In en, this message translates to:
  /// **'Your rating'**
  String get yourRatingTitle;

  /// No description provided for @noRatingsYet.
  ///
  /// In en, this message translates to:
  /// **'No warehouse has rated you yet.'**
  String get noRatingsYet;

  /// No description provided for @ratingSummary.
  ///
  /// In en, this message translates to:
  /// **'{average} average ({count} ratings)'**
  String ratingSummary(String average, String count);

  /// No description provided for @myDebtsTitle.
  ///
  /// In en, this message translates to:
  /// **'My Debts'**
  String get myDebtsTitle;

  /// No description provided for @noDebtsYet.
  ///
  /// In en, this message translates to:
  /// **'No debts right now.'**
  String get noDebtsYet;

  /// No description provided for @totalOrdersLabel.
  ///
  /// In en, this message translates to:
  /// **'Total orders'**
  String get totalOrdersLabel;

  /// No description provided for @totalPaidLabel.
  ///
  /// In en, this message translates to:
  /// **'Total paid'**
  String get totalPaidLabel;

  /// No description provided for @currentBalanceLabel.
  ///
  /// In en, this message translates to:
  /// **'Current balance'**
  String get currentBalanceLabel;

  /// No description provided for @creditBalanceLabel.
  ///
  /// In en, this message translates to:
  /// **'Credit balance'**
  String get creditBalanceLabel;

  /// No description provided for @deliveredOrdersTitle.
  ///
  /// In en, this message translates to:
  /// **'Delivered orders'**
  String get deliveredOrdersTitle;

  /// No description provided for @paymentsTitle.
  ///
  /// In en, this message translates to:
  /// **'Payments'**
  String get paymentsTitle;

  /// No description provided for @noPaymentsYet.
  ///
  /// In en, this message translates to:
  /// **'No payments recorded yet.'**
  String get noPaymentsYet;

  /// No description provided for @rateWarehouseTitle.
  ///
  /// In en, this message translates to:
  /// **'Rate the warehouse'**
  String get rateWarehouseTitle;

  /// No description provided for @rateWarehouseCommentLabel.
  ///
  /// In en, this message translates to:
  /// **'Comment (optional)'**
  String get rateWarehouseCommentLabel;

  /// No description provided for @submitReviewButton.
  ///
  /// In en, this message translates to:
  /// **'Submit rating'**
  String get submitReviewButton;

  /// No description provided for @submitReviewConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Submit rating?'**
  String get submitReviewConfirmTitle;

  /// No description provided for @submitReviewConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'You won\'t be able to change this rating after sending it. Continue?'**
  String get submitReviewConfirmMessage;

  /// No description provided for @reviewThankYouTitle.
  ///
  /// In en, this message translates to:
  /// **'Thanks — you rated this order {rating} stars'**
  String reviewThankYouTitle(String rating);

  /// No description provided for @errorAlreadyReviewed.
  ///
  /// In en, this message translates to:
  /// **'This order has already been rated.'**
  String get errorAlreadyReviewed;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return AppLocalizationsAr();
    case 'en':
      return AppLocalizationsEn();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
