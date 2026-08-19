// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class AppLocalizationsAr extends AppLocalizations {
  AppLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appName => 'فينيكس';

  @override
  String get login => 'تسجيل الدخول';

  @override
  String get logout => 'تسجيل الخروج';

  @override
  String get email => 'البريد الإلكتروني';

  @override
  String get password => 'كلمة المرور';

  @override
  String get settings => 'الإعدادات';

  @override
  String get language => 'اللغة';

  @override
  String get theme => 'المظهر';

  @override
  String get light => 'فاتح';

  @override
  String get dark => 'داكن';

  @override
  String get system => 'النظام';

  @override
  String get save => 'حفظ';

  @override
  String get cancel => 'إلغاء';

  @override
  String get welcome => 'مرحباً';

  @override
  String get home => 'الرئيسية';

  @override
  String get profile => 'الملف الشخصي';

  @override
  String get registrationTitle => 'إنشاء حساب الصيدلية';

  @override
  String get registrationSubtitle => 'أدخل بياناتك للبدء';

  @override
  String get fullNameLabel => 'الاسم الكامل';

  @override
  String get pharmacyNameLabel => 'اسم الصيدلية';

  @override
  String get phoneLabel => 'رقم الهاتف';

  @override
  String get addressLabel => 'العنوان';

  @override
  String get verificationPhotoLabel => 'صورة الصيدلية';

  @override
  String get verificationPhotoHint => 'صورة لواجهة أو لافتة صيدليتك';

  @override
  String get choosePhotoButton => 'اختر صورة';

  @override
  String get changePhotoButton => 'تغيير الصورة';

  @override
  String get photoRequired => 'يرجى إضافة صورة لصيدليتك.';

  @override
  String get confirmPasswordLabel => 'تأكيد كلمة المرور';

  @override
  String get passwordTooShort =>
      'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.';

  @override
  String get passwordMismatch => 'كلمتا المرور غير متطابقتين.';

  @override
  String get alreadyHaveAccountLink => 'عندك حساب؟ سجّل دخول بكلمة السر';

  @override
  String get sendCodeButton => 'إرسال رمز التحقق';

  @override
  String get createAccountButton => 'إنشاء الحساب';

  @override
  String get passwordLoginTitle => 'تسجيل الدخول بكلمة السر';

  @override
  String get passwordLoginSubtitle => 'أدخل رقم هاتفك وكلمة السر';

  @override
  String get backToRegistrationLink => 'جديد هون؟ أنشئ حساب';

  @override
  String get otpTitle => 'أدخل رمز التحقق';

  @override
  String otpInstructions(String phone) {
    return 'أرسلنا رمزاً مكوناً من 6 أرقام عبر رسالة نصية إلى $phone';
  }

  @override
  String get otpCodeLabel => 'رمز التحقق';

  @override
  String get verifyButton => 'تحقق';

  @override
  String get resendCodeButton => 'إعادة إرسال الرمز';

  @override
  String get codeResent => 'تم إرسال رمز جديد.';

  @override
  String get approvalPendingTitle => 'حسابك قيد المراجعة';

  @override
  String get approvalPendingMessage =>
      'نقوم بمراجعة تسجيلك حالياً. ستتمكن من الطلب فور الموافقة على حسابك.';

  @override
  String get approvalPendingBlockedTitle => 'الحساب محظور';

  @override
  String get approvalPendingBlockedMessage =>
      'تم حظر هذا الحساب. يرجى التواصل مع الدعم للمساعدة.';

  @override
  String get refreshStatusButton => 'تحقق من الحالة';

  @override
  String get contactSupportButton => 'تواصل مع الدعم';

  @override
  String get contactSupportDialogTitle => 'تواصل مع الدعم';

  @override
  String get contactSupportDialogMessage =>
      'للمساعدة بخصوص حسابك، يرجى التواصل مع دعم مستودع النجاح.';

  @override
  String get fieldRequired => 'هذا الحقل مطلوب.';

  @override
  String get invalidPhoneNumber => 'يرجى إدخال رقم هاتف صحيح.';

  @override
  String get invalidOtpCode => 'يرجى إدخال الرمز المكون من 6 أرقام.';

  @override
  String get close => 'إغلاق';

  @override
  String get errorState => 'حدث خطأ ما.';

  @override
  String get warehouseSelectionTitle => 'اختر المستودع';

  @override
  String get selectWarehouseButton => 'اختيار';

  @override
  String get noWarehousesAvailable => 'لا توجد مستودعات متاحة حالياً.';

  @override
  String warehouseSelectedMessage(String name) {
    return 'تم اختيار $name. كتالوج المنتجات قادم قريباً.';
  }

  @override
  String get noManufacturersFound =>
      'لا توجد شركات مصنّعة متاحة بهذا المستودع.';

  @override
  String get warehouseProfileTooltip => 'معلومات المستودع';

  @override
  String get deliveryInfoTitle => 'معلومات التوصيل';

  @override
  String deliveryHoursValue(String start, String end) {
    return 'من $start إلى $end';
  }

  @override
  String get deliveryHoursNotSet => 'غير محدّدة';

  @override
  String get deliveryTypeSelfLabel => 'توصيل خاص بالمستودع';

  @override
  String get deliveryTypeThirdPartyLabel => 'شركة توصيل خارجية';

  @override
  String get deliveryInfoDisclaimer =>
      'هذه المعلومات للعرض فقط، ولا تمنع تقديم الطلب.';

  @override
  String get warehouseReviewsTitle => 'التقييمات';

  @override
  String get noWarehouseReviewsYet => 'لا تقييمات بعد.';

  @override
  String get browseWarehouseProductsButton => 'تصفح منتجات هذا المستودع';

  @override
  String get searchProductsHint => 'ابحث بالاسم أو الشركة المصنعة';

  @override
  String get allCategories => 'الكل';

  @override
  String get addToCartButton => 'إضافة';

  @override
  String get unavailableLabel => 'غير متوفر';

  @override
  String get noProductsFound => 'لم يتم العثور على منتجات.';

  @override
  String get currencySuffix => 'ل.س';

  @override
  String addedToCartMessage(String name) {
    return 'تمت إضافة $name إلى السلة.';
  }

  @override
  String get cartTitle => 'السلة';

  @override
  String get cartEmptyMessage => 'سلتك فارغة.';

  @override
  String get notesLabel => 'ملاحظات (اختياري)';

  @override
  String get subtotalLabel => 'المجموع';

  @override
  String get submitOrderButton => 'إرسال الطلب';

  @override
  String get submitOrderTitle => 'إرسال الطلب؟';

  @override
  String submitOrderConfirmation(String warehouseName) {
    return 'إرسال هذا الطلب إلى $warehouseName؟';
  }

  @override
  String get orderSubmittedTitle => 'تم إرسال الطلب';

  @override
  String orderSubmittedMessage(String orderNumber) {
    return 'تم إرسال طلبك رقم $orderNumber.';
  }

  @override
  String get removeItemTitle => 'إزالة العنصر؟';

  @override
  String removeItemConfirmation(String name) {
    return 'إزالة $name من سلتك؟';
  }

  @override
  String get removeButton => 'إزالة';

  @override
  String get cartConflictTitle => 'بدء سلة جديدة؟';

  @override
  String cartConflictMessage(String name) {
    return 'سلتك تحتوي على عناصر من $name. إضافة هذا العنصر ستفرغ السلة وتبدأ طلباً جديداً.';
  }

  @override
  String get cartConflictConfirmButton => 'بدء سلة جديدة';

  @override
  String get cartIconTooltip => 'السلة';

  @override
  String get errorInvalidRequest =>
      'هناك خطأ في هذا الطلب. يرجى المحاولة مرة أخرى.';

  @override
  String get errorPharmacyNotFound =>
      'لم نتمكن من العثور على ملف صيدليتك. يرجى التواصل مع الدعم.';

  @override
  String get errorWarehouseNotFound => 'هذا المستودع لم يعد متاحاً.';

  @override
  String get errorExchangeRateUnavailable =>
      'تعذّر تأكيد الأسعار حالياً. يرجى المحاولة بعد قليل.';

  @override
  String get errorStockCheckFailedGeneric =>
      'بعض العناصر في سلتك لم تعد متاحة كما طُلب.';

  @override
  String errorProductUnavailable(String name) {
    return '$name غير متوفر حالياً.';
  }

  @override
  String errorProductNotFound(String name) {
    return '$name لم يعد متوفراً.';
  }

  @override
  String get thisItemFallback => 'هذا العنصر';

  @override
  String get loading => 'جارِ التحميل...';

  @override
  String get orderTrackingTitle => 'تتبع الطلب';

  @override
  String orderNumberLabel(String number) {
    return 'الطلب رقم $number';
  }

  @override
  String get stageSent => 'تم الإرسال';

  @override
  String get stageUnderReview => 'قيد المراجعة';

  @override
  String get stagePreparing => 'قيد التحضير';

  @override
  String get stageOutForDelivery => 'قيد التوصيل';

  @override
  String get stageDelivered => 'تم التوصيل';

  @override
  String get stageCancelled => 'ملغى';

  @override
  String get statusHistoryTitle => 'سجل الحالة';

  @override
  String get cancelOrderTitle => 'إلغاء الطلب؟';

  @override
  String get cancelOrderConfirmation => 'هل أنت متأكد من إلغاء هذا الطلب؟';

  @override
  String get cancelOrderButton => 'إلغاء الطلب';

  @override
  String get orderCancelledMessage => 'تم إلغاء هذا الطلب.';

  @override
  String get contactWarehouseForChanges =>
      'لأي تغييرات الآن، يرجى التواصل مع المستودع مباشرة.';

  @override
  String get errorOrderNotFound => 'تعذر العثور على هذا الطلب.';

  @override
  String get errorOrderNotCancellable =>
      'لم يعد بالإمكان إلغاء هذا الطلب من التطبيق.';

  @override
  String get myOrdersTitle => 'طلباتي';

  @override
  String get noOrdersYet => 'لم تقم بأي طلبات بعد.';

  @override
  String get invoiceTitle => 'أصناف الطلب';

  @override
  String get discountLabel => 'الخصم';

  @override
  String get invoiceTotalLabel => 'الإجمالي';

  @override
  String youSavedLabel(String amount) {
    return '💰 وفّرت $amount';
  }

  @override
  String totalSavingsLabel(String amount) {
    return '💰 إجمالي التوفير: $amount (شامل خصم العروض وحسم الشركة المصنّعة)';
  }

  @override
  String get returnsTitle => 'المرتجعات';

  @override
  String get noReturnsYet => 'لم تقدّم أي طلب إرجاع بعد.';

  @override
  String get requestReturnTitle => 'طلب إرجاع';

  @override
  String get requestReturnButton => 'إرسال طلب الإرجاع';

  @override
  String get returnQuantityLabel => 'الكمية';

  @override
  String get returnReasonLabel => 'السبب';

  @override
  String get reasonDamaged => 'تالف';

  @override
  String get reasonWrongItem => 'منتج خاطئ';

  @override
  String get reasonOther => 'سبب آخر';

  @override
  String get customReasonLabel => 'يرجى التوضيح';

  @override
  String get returnSubmittedTitle => 'تم إرسال الطلب';

  @override
  String get returnSubmittedMessage =>
      'تم إرسال طلب الإرجاع. سيقوم المستودع بمراجعته.';

  @override
  String get returnStatusPending => 'قيد المراجعة';

  @override
  String get returnStatusApproved => 'تمت الموافقة';

  @override
  String get returnStatusRejected => 'مرفوض';

  @override
  String get returnPickItemsLabel => 'اختر الأصناف يلي بدك ترجعها';

  @override
  String get returnRejectionNoteLabel => 'سبب الرفض';

  @override
  String get viewReplacementOrderButton => 'عرض طلب الاستبدال';

  @override
  String get editButton => 'تعديل';

  @override
  String get deleteReturnButton => 'حذف';

  @override
  String get deleteReturnConfirmTitle => 'حذف طلب الإرجاع؟';

  @override
  String get deleteReturnConfirmMessage => 'هل أنت متأكد من حذف طلب الإرجاع؟';

  @override
  String get returnApprovedBanner =>
      'تمت الموافقة على المرتجع — تم إنشاء طلب استبدال';

  @override
  String get returnPendingReviewBanner =>
      'تم إرسال طلب الإرجاع، بانتظار مراجعة المستودع';

  @override
  String get returnRejectedBanner => 'تم رفض المرتجع';

  @override
  String get errorOrderNotDelivered => 'لم يتم توصيل هذا الطلب بعد.';

  @override
  String get errorOrderItemNotFound => 'تعذر العثور على هذا الصنف ضمن الطلب.';

  @override
  String get errorReturnQuantityExceeded =>
      'كمية الإرجاع تتجاوز الكمية المتاحة لإرجاعها لهذا الصنف.';

  @override
  String get errorCustomReasonRequired => 'يرجى وصف سبب الإرجاع.';

  @override
  String get errorTooManyReturnPhotos => 'ممكن ترفق حتى 5 صور.';

  @override
  String get errorInvalidReturnPhoto => 'إحدى الصور المرفقة مش صورة صالحة.';

  @override
  String get errorReturnAlreadyExists =>
      'تم إرسال طلب إرجاع لهذا الطلب من قبل.';

  @override
  String get errorReturnNotEditable =>
      'تم اتخاذ قرار بخصوص طلب الإرجاع هذا ولم يعد بالإمكان تعديله.';

  @override
  String get errorReturnItemsEmpty => 'يرجى اختيار صنف واحد على الأقل للإرجاع.';

  @override
  String get errorDuplicateReturnItem =>
      'كل صنف ممكن يظهر مرة وحدة بس بطلب الإرجاع.';

  @override
  String get errorRejectionNoteRequired => 'يرجى توضيح سبب رفض هذا المرتجع.';

  @override
  String get returnPhotosLabel => 'صور (اختياري)';

  @override
  String get returnPhotosHint => 'أضف صور للمنتج تساعد المستودع يتحقق من السبب';

  @override
  String get addPhotoButton => 'إضافة صورة';

  @override
  String get navWarehouses => 'المستودعات';

  @override
  String get profileTitle => 'البروفايل';

  @override
  String get logoutConfirmTitle => 'تسجيل الخروج؟';

  @override
  String get logoutConfirmMessage => 'هل أنت متأكد من تسجيل الخروج؟';

  @override
  String get yourRatingTitle => 'تقييمك';

  @override
  String get noRatingsYet => 'ما في مستودع قيّمك لهلق.';

  @override
  String ratingSummary(String average, String count) {
    return '$average بالمعدل ($count تقييم)';
  }

  @override
  String get myDebtsTitle => 'ديوني';

  @override
  String get noDebtsYet => 'لا توجد ديون حالياً.';

  @override
  String get totalOrdersLabel => 'إجمالي الطلبات';

  @override
  String get totalPaidLabel => 'إجمالي المدفوع';

  @override
  String get currentBalanceLabel => 'الدين الحالي';

  @override
  String get creditBalanceLabel => 'رصيد لصالحك';

  @override
  String get deliveredOrdersTitle => 'الطلبات المسلّمة';

  @override
  String get paymentsTitle => 'الدفعات';

  @override
  String get noPaymentsYet => 'لا توجد دفعات مسجّلة.';

  @override
  String get rateWarehouseTitle => 'قيّم المستودع';

  @override
  String get rateWarehouseCommentLabel => 'تعليق (اختياري)';

  @override
  String get submitReviewButton => 'إرسال التقييم';

  @override
  String get submitReviewConfirmTitle => 'إرسال التقييم؟';

  @override
  String get submitReviewConfirmMessage =>
      'لن تتمكن من تعديل هذا التقييم بعد إرساله. متابعة؟';

  @override
  String reviewThankYouTitle(String rating) {
    return 'شكراً — قيّمت هذا الطلب بـ $rating نجوم';
  }

  @override
  String get errorAlreadyReviewed => 'تم تقييم هذا الطلب من قبل.';
}
