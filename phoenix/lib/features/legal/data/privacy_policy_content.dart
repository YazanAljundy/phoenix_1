// The full text of the Feniq / Phoenix privacy policy, kept deliberately
// separate from any widget so the wording can be revised without touching UI
// code. `PrivacyPolicyBody` (presentation/widgets) is the only reader.
//
// Every statement here was written against what the app and backend actually
// do as of the "last updated" date below - it is not a generic template.
// Items still awaiting confirmation from the project owner are marked with a
// bracketed placeholder ([ ... ]) both here and in the delivery report.

/// One heading + its ordered content blocks.
class PrivacyPolicySection {
  const PrivacyPolicySection({required this.title, required this.blocks});

  final String title;
  final List<PolicyBlock> blocks;
}

/// A renderable piece of a section. Sealed so `PrivacyPolicyBody`'s switch is
/// exhaustive.
sealed class PolicyBlock {
  const PolicyBlock();
}

/// A normal paragraph.
class PolicyParagraph extends PolicyBlock {
  const PolicyParagraph(this.text);
  final String text;
}

/// A small bold line inside a section (e.g. "Information you give us").
class PolicySubheading extends PolicyBlock {
  const PolicySubheading(this.text);
  final String text;
}

/// A bulleted list.
class PolicyBullets extends PolicyBlock {
  const PolicyBullets(this.items);
  final List<String> items;
}

class PrivacyPolicyContent {
  const PrivacyPolicyContent._();

  /// The date this policy text was last revised. Bump this whenever the
  /// wording below changes.
  static final DateTime lastUpdated = DateTime.utc(2026, 8, 27);

  // Levantine month names - Syria uses these rather than the MSA set.
  static const List<String> _arMonths = [
    'كانون الثاني',
    'شباط',
    'آذار',
    'نيسان',
    'أيار',
    'حزيران',
    'تموز',
    'آب',
    'أيلول',
    'تشرين الأول',
    'تشرين الثاني',
    'كانون الأول',
  ];

  static const List<String> _enMonths = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  /// "27 آب 2026" / "August 27, 2026" - no dependency on intl locale data
  /// being initialised.
  static String formattedLastUpdated({required bool isArabic}) {
    final d = lastUpdated;
    if (isArabic) {
      return '${d.day} ${_arMonths[d.month - 1]} ${d.year}';
    }
    return '${_enMonths[d.month - 1]} ${d.day}, ${d.year}';
  }

  static String title({required bool isArabic}) =>
      isArabic ? 'سياسة الخصوصية' : 'Privacy Policy';

  static List<PrivacyPolicySection> sections({required bool isArabic}) =>
      isArabic ? _arabicSections : _englishSections;

  // ---------------------------------------------------------------------------
  // العربية
  // ---------------------------------------------------------------------------

  static const List<PrivacyPolicySection> _arabicSections = [
    PrivacyPolicySection(
      title: '1. مقدمة',
      blocks: [
        PolicyParagraph(
          'تطبيق فينيق (Feniq / Phoenix) هو منصّة تجارية (B2B) تربط الصيدليات '
          'بمستودعات الأدوية داخل سوريا (بدءاً من مدينة اللاذقية)، وتتيح للصيدلية '
          'تصفّح المنتجات وإرسال الطلبات وتتبّعها وطلب الإرجاع وتقييم المستودعات '
          'ومتابعة الرصيد المستحق.',
        ),
        PolicyParagraph(
          'توضّح هذه السياسة البيانات التي نجمعها منك عند استخدامك تطبيق '
          'الهاتف، وكيف نستخدمها ونحميها ومع مَن نشاركها. تنطبق السياسة على '
          'تطبيق فينيق للهاتف والخادم (backend) المرتبط به، وعلى لوحة الويب '
          'المخصّصة للمستودعات والإدارة.',
        ),
        PolicyParagraph(
          'باستخدامك للتطبيق فإنك توافق على الممارسات الموضّحة هنا. إن لم توافق '
          'عليها، فيرجى عدم استخدام التطبيق.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '2. البيانات التي نجمعها',
      blocks: [
        PolicySubheading('2.1 بيانات تزوّدنا بها مباشرة'),
        PolicyBullets([
          'عند إنشاء الحساب: الاسم الكامل، اسم الصيدلية (بالعربية والإنجليزية)، '
              'رقم الهاتف، وكلمة المرور.',
          'موقع الصيدلية: تحدّده عبر دبوس على الخريطة أثناء التسجيل. نحفظ '
              'إحداثيات الدبوس ونصّ العنوان الناتج عن تحويل تلك الإحداثيات إلى '
              'عنوان.',
          'الطلبات: الأصناف والكميات وأي ملاحظات تكتبها على الطلب أو عند إلغائه.',
          'طلبات الإرجاع: الأصناف وسبب الإرجاع ونصّ حرّ للسبب/الملاحظات، '
              'بالإضافة إلى صورة واحدة أو أكثر للأصناف المعنية تختارها من '
              'الكاميرا أو معرض الصور.',
          'التقييمات: تقييم من 1 إلى 5 وتعليق اختياري عن المستودع.',
          'التواصل مع الدعم: عند الضغط على زر التواصل عبر واتساب يُفتح تطبيق '
              'واتساب على رقم الجهة المعنية؛ محتوى رسالتك يمرّ عبر واتساب وليس '
              'عبر خوادمنا.',
        ]),
        PolicySubheading('2.2 بيانات تُجمع تلقائياً'),
        PolicyBullets([
          'رمز الإشعارات (FCM token) الخاص بجهازك ونوع النظام (Android أو iOS) '
              '— فقط بعد منحك إذن الإشعارات.',
          'بيانات تقنية عن كل طلب تُرسله إلى الخادم: عنوان IP، والتاريخ والوقت، '
              'ومسار الطلب، ومُعرِّف التطبيق/نظام التشغيل (user-agent)؛ تُسجَّل في '
              'سجلّات الخادم لأغراض الأمان ومنع الإساءة وحلّ المشكلات.',
          'تفضيلاتك داخل التطبيق (اللغة، المظهر الفاتح/الداكن) — تُحفظ على '
              'جهازك فقط.',
          'رمز الجلسة (token) — يُحفظ في التخزين الآمن على جهازك لإبقائك مسجّلاً '
              'للدخول.',
        ]),
        PolicySubheading('2.3 بيانات لا نجمعها'),
        PolicyParagraph(
          'لا يستخدم التطبيق أدوات تحليلات (analytics) أو تتبّع أعطال '
          '(crash reporting)، ولا يتتبّعك عبر تطبيقات أو مواقع أخرى، ولا يجمع '
          'جهات الاتصال أو التقويم أو الميكروفون، ولا يصل إلى موقعك في الخلفية.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '3. كيف نستخدم بياناتك',
      blocks: [
        PolicyBullets([
          'إنشاء حسابك وتأمينه، ومراجعته والموافقة عليه يدوياً من قِبل الإدارة.',
          'عرض بيانات صيدليتك وطلباتك للمستودع الذي تطلب منه ولمشرفي المنصّة.',
          'تنفيذ الطلبات وطلبات الإرجاع/الاستبدال والتقييمات، وعرض رصيدك '
              'المستحق لدى كل مستودع.',
          'إرسال إشعارات لك حول حالة الطلبات والعروض وإعلانات الإدارة.',
          'تحويل الأسعار بين الليرة السورية والدولار الأمريكي.',
          'منع إساءة الاستخدام وتطبيق حدود المعدّل، وصيانة الخدمة وإصلاح '
              'الأعطال.',
          'الامتثال للقوانين المعمول بها والاستجابة للطلبات القانونية '
              'المشروعة.',
        ]),
        PolicyParagraph(
          'لا نبيع بياناتك الشخصية، ولا نستخدمها لأغراض إعلانية.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '4. بيانات الحساب والمصادقة',
      blocks: [
        PolicyParagraph(
          'يتم تسجيل الدخول برقم الهاتف وكلمة المرور. تُخزَّن كلمة المرور على '
          'شكل بصمة مُشفّرة (bcrypt hash) فقط، ولا تُحفظ بنصّها الصريح، ولا '
          'تُعيدها واجهة البرمجة (API) في أي استجابة.',
        ),
        PolicyParagraph(
          'التحقّق من رقم الهاتف عبر رمز SMS غير مُفعَّل حالياً؛ يتم التحقّق من '
          'الحساب عبر المراجعة اليدوية من قِبل الإدارة.',
        ),
        PolicyParagraph(
          'يُحفظ رمز جلسة (JWT) بصلاحية سبعة أيام تقريباً في التخزين الآمن على '
          'جهازك (Keychain على iOS و Keystore على Android). أمّا لوحة الويب '
          'للمستودعات والإدارة فتحفظ الرمز في تخزين المتصفّح المحلي '
          '(localStorage).',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '5. بيانات الطلبات والمعاملات',
      blocks: [
        PolicyParagraph(
          'نحفظ الطلبات وأصنافها والأسعار والخصومات والعمولات وسجلّ تغيّر '
          'الحالة وأسباب الإلغاء وطلبات الإرجاع، بالإضافة إلى سجلّات الدفعات '
          'التي يُدخلها المستودع، وذلك لتشغيل الخدمة وعرض سجلّك ورصيدك.',
        ),
        PolicyParagraph(
          'الدفعات يسجّلها المستودع يدوياً مقابل مبالغ نقدية أو تحويلات تتم '
          'خارج التطبيق. لا يعالج التطبيق أي مدفوعات بالبطاقات ولا يتعامل مع أي '
          'بوّابة دفع.',
        ),
        PolicyParagraph(
          'هذه البيانات مرئية للمستودع الطرف الآخر في المعاملة ولمشرفي المنصّة.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '6. الإشعارات (Push Notifications)',
      blocks: [
        PolicyParagraph(
          'إذا سمحت بالإشعارات، نسجّل لدى خادمنا رمز إشعارات (FCM token) خاصاً '
          'بجهازك، ونستخدم خدمة Google Firebase Cloud Messaging لإرسال '
          'الرسائل إليك (تحديثات الطلبات، العروض، إعلانات الإدارة).',
        ),
        PolicyParagraph(
          'يمرّ محتوى الإشعار وحمولة بيانات صغيرة (النوع، ومُعرِّف الطلب المرتبط '
          'إن وُجد) عبر بنية Google التحتية للإشعارات.',
        ),
        PolicyParagraph(
          'يمكنك إيقاف الإشعارات من إعدادات جهازك في أي وقت وسيستمر التطبيق '
          'بالعمل. تُحذف الرموز غير الصالحة تلقائياً، ويُنقل رمز جهازك من الحساب '
          'السابق عند تسجيل دخول حساب آخر على الجهاز نفسه.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '7. معلومات الجهاز',
      blocks: [
        PolicyParagraph(
          'نحفظ رمز الإشعارات (FCM token) ونوع منصّة جهازك (android/ios).',
        ),
        PolicyParagraph(
          'تتضمّن سجلّات الخادم عنوان IP الخاص بك وبيانات الطلب الوصفية كما هو '
          'موضّح في القسم 2.',
        ),
        PolicyParagraph(
          'لا نجمع مُعرِّفاً ثابتاً للجهاز أو مُعرِّفاً إعلانياً.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '8. الصور والملفات والوسائط',
      blocks: [
        PolicyParagraph(
          'الوسائط الوحيدة التي نجمعها هي الصور التي ترفقها بطلب الإرجاع، '
          'وتختارها من الكاميرا أو معرض الصور. يطلب التطبيق إذن الكاميرا/الصور '
          'في تلك اللحظة فقط.',
        ),
        PolicyParagraph(
          'تُخزَّن صور الإرجاع على مساحة تخزين خادمنا، ويمكن الوصول إليها عبر '
          'رابط يحتوي مُعرِّفاً عشوائياً يصعب تخمينه، وتُشارَك مع المستودع الذي '
          'يعالج طلب الإرجاع ومع الإدارة.',
        ),
        PolicyParagraph(
          'تُحذف الصور عند إزالتها من طلب إرجاع ما زال «قيد المراجعة» أو عند '
          'حذف ذلك الطلب؛ وفي غير ذلك تبقى مرتبطة بسجلّ الإرجاع. '
          '[مدّة الاحتفاظ بها بعد إغلاق الحساب — بانتظار التأكيد.]',
        ),
        PolicyParagraph(
          'ملفات Excel الخاصة بقوائم الأدوية يرفعها مستخدمو المستودعات والإدارة '
          'فقط، وليس الصيدليات.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '9. بيانات الموقع',
      blocks: [
        PolicyParagraph(
          'أثناء التسجيل فقط، يعرض التطبيق خريطة لتضع دبوس موقع صيدليتك. '
          'وبعد إذنك يمكنه توسيط الخريطة على موقعك الحالي عبر GPS، كما يمكنك '
          'تحريك الدبوس يدوياً.',
        ),
        PolicyParagraph(
          'نحفظ إحداثيات الدبوس ونصّ العنوان الناتج عنها. لا يُطلب الموقع إلا في '
          'تلك الشاشة، ولا يُطلب أبداً في الخلفية. إذا رفضت إذن الموقع يمكنك '
          'وضع الدبوس يدوياً.',
        ),
        PolicyParagraph(
          'تُحمَّل بلاطات الخريطة من OpenStreetMap، ويتم تحويل الإحداثيات إلى '
          'عنوان عبر خدمة Nominatim التابعة لـ OpenStreetMap؛ يستقبل هذان '
          'الطرفان إحداثيات الخريطة وعنوان IP لجهازك عند استخدام الخريطة.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '10. الكوكيز والتخزين المحلي',
      blocks: [
        PolicyParagraph(
          'لا يستخدم تطبيق الهاتف أي كوكيز. يخزّن على جهازك فقط: تفضيلات اللغة '
          'والمظهر، ورمز جلستك في التخزين الآمن.',
        ),
        PolicyParagraph(
          'لوحة الويب للمستودعات والإدارة (لا تستخدمها الصيدليات) تخزّن رمز '
          'الجلسة واختيار اللغة في تخزين المتصفّح المحلي (localStorage)، ولا '
          'تضع أي كوكيز إعلانية أو تتبّعية.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '11. خدمات الأطراف الثالثة',
      blocks: [
        PolicyBullets([
          'Google Firebase Cloud Messaging — تسليم الإشعارات (يستقبل رمز '
              'جهازك ومحتوى الرسالة).',
          'OpenStreetMap و Nominatim — بلاطات الخريطة وتحويل الإحداثيات إلى '
              'عنوان أثناء التسجيل (يستقبلان الإحداثيات وعنوان IP).',
          'Open Exchange Rates — أسعار صرف العملات؛ لا تُرسَل أي بيانات شخصية.',
          'Google Fonts — يُنزّل التطبيق خط «Cairo» وقت التشغيل من خوادم '
              'Google، والتي تستقبل عنوان IP لجهازك.',
          'مزوّد قاعدة البيانات ومزوّد استضافة الخادم — بنية تحتية تخزّن '
              'البيانات وتعالج الطلبات نيابةً عنّا. '
              '[أسماء المزوّدين والمنطقة الجغرافية — بانتظار التأكيد.]',
          'واتساب — فقط إذا ضغطت زر «التواصل عبر واتساب»، فيُفتح واتساب على '
              'محادثة جاهزة؛ ما ترسله يخضع لسياسة واتساب.',
        ]),
        PolicyParagraph(
          'لا نتحكّم بممارسات هذه الأطراف الخاصة بها، ونشجّعك على مراجعة '
          'سياسات الخصوصية الخاصة بكلٍّ منها.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '12. مشاركة البيانات',
      blocks: [
        PolicyBullets([
          'مع المستودع الذي تتعامل معه: اسمك، واسم الصيدلية، ورقم الهاتف، '
              'والعنوان/الموقع، والطلبات، وطلبات الإرجاع وصورها، والتقييمات، '
              'والرصيد.',
          'مع مشرفي المنصّة: البيانات نفسها، لأغراض الموافقة على الحسابات '
              'والدعم والإشراف وحلّ النزاعات.',
          'مع مزوّدي الخدمات المذكورين في القسم 11، فقط بالقدر اللازم لتشغيل '
              'الخدمة.',
          'لأسباب قانونية: للامتثال للقوانين المعمول بها أو الإجراءات القانونية '
              'المشروعة، أو لحماية الحقوق والسلامة وسلامة المنصّة.',
          'في حال نقل النشاط التجاري (اندماج أو استحواذ)، مع بقاء البيانات '
              'خاضعة لهذه السياسة.',
        ]),
        PolicyParagraph('لا نبيع البيانات الشخصية ولا نشاركها لأغراض إعلانية.'),
      ],
    ),
    PrivacyPolicySection(
      title: '13. تخزين البيانات وأمنها',
      blocks: [
        PolicyParagraph(
          'تُخزَّن البيانات في قاعدة بيانات MongoDB وعلى مساحة تخزين الملفات '
          'الخاصة بالخادم، لدى مزوّدي البنية التحتية والاستضافة. '
          '[المنطقة الجغرافية للتخزين — بانتظار التأكيد.]',
        ),
        PolicyParagraph('من إجراءات الحماية المطبَّقة في المنصّة:'),
        PolicyBullets([
          'تشفير كلمات المرور ببصمة bcrypt.',
          'المصادقة عبر رموز JWT موقَّعة.',
          'نقل البيانات عبر HTTPS.',
          'ترويسات أمان HTTP عبر مكتبة Helmet.',
          'تنقية المدخلات ومنع حقن الاستعلامات.',
          'تحديد معدّل الطلبات على واجهة البرمجة.',
          'التحقّق من نوع وحجم الملفات المرفوعة، بما في ذلك فحص التوقيع الثنائي '
              '(magic bytes).',
          'التحقّق من الصلاحيات حسب الدور على كل نقطة نهاية.',
        ]),
        PolicyParagraph(
          'لا توجد وسيلة نقل أو تخزين آمنة بنسبة 100%، ولا يمكننا ضمان الأمان '
          'المطلق.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '14. مدّة الاحتفاظ بالبيانات',
      blocks: [
        PolicyBullets([
          'تُحفظ بيانات الحساب والطلبات وطلبات الإرجاع والتقييمات والأرصدة '
              'وسجلّ الإشعارات طوال بقاء حسابك وبالقدر اللازم لتقديم الخدمة '
              'وحلّ النزاعات والوفاء بالالتزامات القانونية والمحاسبية.',
          'صور الإرجاع: انظر القسم 8.',
          'رموز التحقّق لمرة واحدة (في حال تفعيل التحقّق عبر SMS مستقبلاً) '
              'تنتهي صلاحيتها وتُحذف تلقائياً خلال دقائق.',
          'سجلّات الخادم يحتفظ بها مزوّد الاستضافة لمدة قصيرة ومتجدّدة.',
        ]),
        PolicyParagraph(
          '[مدد الاحتفاظ المحدّدة بعد إغلاق الحساب — بانتظار التأكيد.]',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '15. حقوقك',
      blocks: [
        PolicyParagraph(
          'وفقاً للقوانين المعمول بها في بلدك، قد يكون لك الحق في الوصول إلى '
          'بياناتك الشخصية وتصحيحها وتحديثها وحذفها، وفي الاعتراض على معالجة '
          'معيّنة أو تقييدها، وفي الحصول على نسخة من بياناتك.',
        ),
        PolicyParagraph(
          'بعض البيانات (الاسم، اسم الصيدلية) يمكن تعديلها بمساعدة الدعم؛ '
          'ويوفّر التطبيق حالياً إمكانيات تعديل ذاتي محدودة.',
        ),
        PolicyParagraph(
          'لممارسة أيٍّ من هذه الحقوق، تواصل معنا (القسم 19). قد نحتاج إلى '
          'التحقّق من هويتك، مثلاً عبر رقم هاتفك المسجّل.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '16. حذف الحساب والبيانات',
      blocks: [
        PolicyParagraph(
          'لا يتضمّن التطبيق حالياً زرّاً ذاتياً لحذف الحساب.',
        ),
        PolicyParagraph(
          'لحذف حسابك والبيانات الشخصية المرتبطة به، تواصل معنا عبر قناة الدعم '
          'المتاحة في التطبيق أو عبر بيانات التواصل في القسم 19. سنعالج الطلب '
          'خلال مدة معقولة، مع استثناء السجلّات التي يلزمنا الاحتفاظ بها '
          'لأغراض قانونية أو ضريبية أو لحلّ النزاعات (مثل سجلّات المعاملات).',
        ),
        PolicyParagraph(
          'قد تبقى الطلبات وطلبات الإرجاع التي تخصّ مستودعاً ما ضمن سجلّات ذلك '
          'المستودع.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '17. خصوصية الأطفال',
      blocks: [
        PolicyParagraph(
          'فينيق أداة عمل موجّهة للصيدليات المرخّصة وموظّفيها المخوّلين، وليست '
          'موجّهة للأطفال. الاستخدام مخصّص لمن أعمارهم 18 عاماً فأكثر. لا نجمع '
          'عن قصد بيانات من الأطفال. [شرط العمر — بانتظار التأكيد.]',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '18. التغييرات على هذه السياسة',
      blocks: [
        PolicyParagraph(
          'قد نُحدّث هذه السياسة من وقت لآخر. سيتغيّر تاريخ «آخر تحديث»، وسنعلن '
          'عن أي تغييرات جوهرية داخل التطبيق (مثلاً عبر إشعار أو تنبيه في هذه '
          'الشاشة). استمرارك في استخدام التطبيق بعد التحديث يعني قبولك للسياسة '
          'المعدّلة.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '19. التواصل معنا',
      blocks: [
        PolicyParagraph(
          'لأي سؤال حول هذه السياسة أو حول بياناتك، أو لتقديم طلب متعلّق '
          'بالخصوصية:',
        ),
        PolicyBullets([
          'الجهة المشغّلة للتطبيق: [الاسم القانوني — بانتظار التأكيد].',
          'البريد الإلكتروني للتواصل: [بانتظار التأكيد].',
          'البريد الإلكتروني لطلبات الخصوصية: [بانتظار التأكيد].',
          'الهاتف / واتساب: [بانتظار التأكيد].',
          'العنوان: [بانتظار التأكيد، إن لزم].',
          'نطاق التشغيل: سوريا (اللاذقية بدايةً). [بانتظار التأكيد.]',
        ]),
        PolicyParagraph(
          'كما يمكنك استخدام خيار التواصل مع الدعم المتاح داخل التطبيق.',
        ),
      ],
    ),
  ];

  // ---------------------------------------------------------------------------
  // English
  // ---------------------------------------------------------------------------

  static const List<PrivacyPolicySection> _englishSections = [
    PrivacyPolicySection(
      title: '1. Introduction',
      blocks: [
        PolicyParagraph(
          'Feniq (also "Phoenix") is a business-to-business (B2B) platform that '
          'connects pharmacies with medical warehouses in Syria (starting with '
          'the city of Latakia). It lets a pharmacy browse products, place and '
          'track orders, request returns, rate warehouses, and follow its '
          'outstanding balance.',
        ),
        PolicyParagraph(
          'This policy explains what data we collect from you when you use the '
          'mobile app, and how we use, protect, and share it. It covers the '
          'Feniq mobile app and its backend server, as well as the web panel '
          'used by warehouses and administrators.',
        ),
        PolicyParagraph(
          'By using the app you agree to the practices described here. If you '
          'do not agree, please do not use the app.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '2. Information We Collect',
      blocks: [
        PolicySubheading('2.1 Information you give us directly'),
        PolicyBullets([
          'When you create an account: your full name, pharmacy name (in Arabic '
              'and English), phone number, and password.',
          'Your pharmacy location, which you set with a map pin during '
              'registration. We store the pin coordinates and the street '
              'address text derived from them.',
          'Orders: the products, quantities, and any notes you add to an order '
              'or when cancelling it.',
          'Return requests: the items, the reason, free-text reason/notes, and '
              'one or more photos of the affected items that you choose from '
              'your camera or photo library.',
          'Reviews: a 1–5 rating and an optional comment about a warehouse.',
          'Support contact: tapping a "contact via WhatsApp" button opens '
              'WhatsApp with the relevant phone number; your message content '
              'goes through WhatsApp, not our servers.',
        ]),
        PolicySubheading('2.2 Information collected automatically'),
        PolicyBullets([
          'Your device push token (FCM token) and platform (Android or iOS) — '
              'only after you grant notification permission.',
          'Technical data for each request to our server: IP address, date and '
              'time, request path, and app/OS user-agent; recorded in server '
              'logs for security, abuse prevention, and troubleshooting.',
          'Your in-app preferences (language, light/dark theme) — stored on '
              'your device only.',
          'Your session token — stored in secure storage on your device to '
              'keep you signed in.',
        ]),
        PolicySubheading('2.3 Information we do not collect'),
        PolicyParagraph(
          'The app uses no analytics or crash-reporting tools, does not track '
          'you across other apps or websites, does not collect your contacts, '
          'calendar, or microphone, and never accesses your location in the '
          'background.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '3. How We Use Your Information',
      blocks: [
        PolicyBullets([
          'To create and secure your account, and to review and approve it '
              'manually by an administrator.',
          'To show your pharmacy details and orders to the warehouse you order '
              'from and to platform administrators.',
          'To process orders, returns/replacements, and reviews, and to show '
              'your outstanding balance with each warehouse.',
          'To send you notifications about order status, offers, and admin '
              'announcements.',
          'To convert prices between Syrian pounds and US dollars.',
          'To prevent abuse and enforce rate limits, and to maintain and '
              'debug the service.',
          'To comply with applicable law and respond to lawful requests.',
        ]),
        PolicyParagraph(
          'We do not sell your personal data and we do not use it for '
          'advertising.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '4. Account and Authentication Data',
      blocks: [
        PolicyParagraph(
          'You sign in with your phone number and password. Passwords are '
          'stored only as a bcrypt hash, never in plain text, and are never '
          'returned by the API in any response.',
        ),
        PolicyParagraph(
          'Phone-number verification by SMS code is not currently enabled; '
          'account verification is done by manual administrator review.',
        ),
        PolicyParagraph(
          'A session token (JWT), valid for about seven days, is stored in '
          'secure storage on your device (Keychain on iOS, Keystore on '
          'Android). The warehouse/admin web panel stores the token in the '
          "browser's local storage (localStorage).",
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '5. Orders and Transaction Data',
      blocks: [
        PolicyParagraph(
          'We store orders and their items, prices, discounts, commissions, '
          'status history, cancellation reasons, and return requests, along '
          'with the payment records a warehouse enters, in order to operate '
          'the service and show you your history and balance.',
        ),
        PolicyParagraph(
          'Payments are recorded manually by the warehouse for cash or '
          'transfers settled outside the app. The app does not process any '
          'card payments and uses no payment gateway.',
        ),
        PolicyParagraph(
          'This data is visible to the counterparty warehouse in the '
          'transaction and to platform administrators.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '6. Push Notifications',
      blocks: [
        PolicyParagraph(
          'If you allow notifications, we register a push token (FCM token) '
          'for your device with our server and use Google Firebase Cloud '
          'Messaging to deliver messages to you (order updates, offers, admin '
          'announcements).',
        ),
        PolicyParagraph(
          "The notification content and a small data payload (the type, and "
          'the related order id if any) pass through Google’s notification '
          'infrastructure.',
        ),
        PolicyParagraph(
          'You can turn notifications off in your device settings at any time '
          'and the app keeps working. Dead tokens are removed automatically, '
          'and your device token is moved off the previous account when a '
          'different account signs in on the same device.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '7. Device Information',
      blocks: [
        PolicyParagraph(
          'We store your push token (FCM token) and your device platform '
          '(android/ios).',
        ),
        PolicyParagraph(
          'Server logs include your IP address and request metadata as '
          'described in Section 2.',
        ),
        PolicyParagraph(
          'We do not collect a persistent hardware identifier or an '
          'advertising identifier.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '8. Photos, Files, and Media',
      blocks: [
        PolicyParagraph(
          'The only media we collect are the photos you attach to a return '
          'request, chosen from your camera or photo library. The app requests '
          'camera/photo access only at that moment.',
        ),
        PolicyParagraph(
          "Return photos are stored on our server’s file storage and are "
          'accessible through a link that contains a random, hard-to-guess '
          'identifier. They are shared with the warehouse handling the return '
          'and with administrators.',
        ),
        PolicyParagraph(
          'Photos are deleted when you remove them from a still-pending return '
          'or delete that return; otherwise they remain attached to the return '
          'record. [Retention beyond that, after account closure — pending '
          'confirmation.]',
        ),
        PolicyParagraph(
          'Excel product-list files are uploaded only by warehouse and admin '
          'users, not by pharmacies.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '9. Location Data',
      blocks: [
        PolicyParagraph(
          "During registration only, the app shows a map so you can place your "
          "pharmacy’s location pin. With your permission it can center the "
          'map on your current GPS location; you can also move the pin '
          'manually.',
        ),
        PolicyParagraph(
          'We store the pin coordinates and the address text derived from '
          'them. Location is requested only on that screen and never in the '
          'background. If you deny location permission you can still place the '
          'pin manually.',
        ),
        PolicyParagraph(
          'Map tiles are loaded from OpenStreetMap, and coordinates are turned '
          "into an address by OpenStreetMap’s Nominatim service. These "
          "third parties receive the map coordinates and your device’s IP "
          'address when the map is used.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '10. Cookies and Local Storage',
      blocks: [
        PolicyParagraph(
          'The mobile app uses no cookies. It stores on your device only your '
          'language and theme preferences and your session token (in secure '
          'storage).',
        ),
        PolicyParagraph(
          'The warehouse/admin web panel (not used by pharmacies) stores the '
          'session token and language choice in the browser’s local '
          'storage (localStorage) and sets no advertising or tracking '
          'cookies.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '11. Third-Party Services',
      blocks: [
        PolicyBullets([
          'Google Firebase Cloud Messaging — notification delivery (receives '
              'your device token and the message content).',
          'OpenStreetMap and Nominatim — map tiles and address lookup during '
              'registration (receive coordinates and IP address).',
          'Open Exchange Rates — currency exchange rates; no personal data is '
              'sent.',
          'Google Fonts — the app downloads the "Cairo" font at runtime from '
              "Google’s servers, which receive your device’s IP "
              'address.',
          'Our database provider and server hosting provider — infrastructure '
              'that stores data and processes requests on our behalf. '
              '[Provider names and region — pending confirmation.]',
          'WhatsApp — only if you tap a "contact via WhatsApp" button, which '
              'opens WhatsApp with a prefilled chat; what you send is governed '
              "by WhatsApp’s policy.",
        ]),
        PolicyParagraph(
          "We do not control these third parties’ own practices and "
          'encourage you to review their privacy policies.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '12. Data Sharing',
      blocks: [
        PolicyBullets([
          'With the warehouse you deal with: your name, pharmacy name, phone '
              'number, address/location, orders, return requests and their '
              'photos, reviews, and balance.',
          'With platform administrators: the same data, for account approval, '
              'support, moderation, and dispute resolution.',
          'With the service providers listed in Section 11, only as needed to '
              'run the service.',
          'For legal reasons: to comply with applicable law or lawful legal '
              'process, or to protect rights, safety, and the integrity of the '
              'platform.',
          'In a business transfer (merger or acquisition), with the data '
              'remaining subject to this policy.',
        ]),
        PolicyParagraph(
          'We do not sell personal data and do not share it for advertising.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '13. Data Storage and Security',
      blocks: [
        PolicyParagraph(
          "Data is stored in a MongoDB database and on the server’s file "
          'storage, with our infrastructure and hosting providers. [Storage '
          'region — pending confirmation.]',
        ),
        PolicyParagraph('Security measures in place on the platform include:'),
        PolicyBullets([
          'Passwords hashed with bcrypt.',
          'Authentication via signed JWTs.',
          'Data in transit over HTTPS.',
          'HTTP security headers via the Helmet library.',
          'Input sanitization and query-injection prevention.',
          'API rate limiting.',
          'Upload type and size validation, including a binary-signature '
              '(magic bytes) check.',
          'Role-based authorization on every endpoint.',
        ]),
        PolicyParagraph(
          'No method of transmission or storage is 100% secure, and we cannot '
          'guarantee absolute security.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '14. Data Retention',
      blocks: [
        PolicyBullets([
          'Account, order, return, review, balance, and notification records '
              'are kept for as long as your account exists and as needed to '
              'provide the service, resolve disputes, and meet legal and '
              'accounting obligations.',
          'Return photos: see Section 8.',
          'One-time verification codes (if SMS verification is enabled in the '
              'future) expire and are deleted automatically within minutes.',
          'Server logs are retained by the hosting provider on a short, '
              'rolling basis.',
        ]),
        PolicyParagraph(
          '[Specific retention periods after account closure — pending '
          'confirmation.]',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '15. User Rights',
      blocks: [
        PolicyParagraph(
          'Depending on the laws that apply in your country, you may have the '
          'right to access, correct, update, and delete your personal data, to '
          'object to or restrict certain processing, and to obtain a copy of '
          'your data.',
        ),
        PolicyParagraph(
          'Some data (your name, pharmacy name) can be changed with help from '
          'support; the app currently offers limited self-service editing.',
        ),
        PolicyParagraph(
          'To exercise any of these rights, contact us (Section 19). We may '
          'need to verify your identity, for example via your registered phone '
          'number.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '16. Account and Data Deletion',
      blocks: [
        PolicyParagraph(
          'The app does not currently include a self-service "delete account" '
          'button.',
        ),
        PolicyParagraph(
          'To delete your account and the personal data associated with it, '
          'contact us through the support channel in the app or via the '
          'contact details in Section 19. We will process the request within a '
          'reasonable period, except for records we must retain for legal, '
          'tax, or dispute-resolution purposes (such as transaction records).',
        ),
        PolicyParagraph(
          'Orders and return requests that involve a warehouse may remain in '
          "that warehouse’s records.",
        ),
      ],
    ),
    PrivacyPolicySection(
      title: "17. Children’s Privacy",
      blocks: [
        PolicyParagraph(
          'Feniq is a business tool intended for licensed pharmacies and their '
          'authorized staff, and is not directed to children. It is intended '
          'for users aged 18 or older. We do not knowingly collect data from '
          'children. [Age requirement — pending confirmation.]',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '18. Changes to This Privacy Policy',
      blocks: [
        PolicyParagraph(
          'We may update this policy from time to time. The "Last updated" '
          'date will change, and we will announce any material changes in the '
          'app (for example via a notification or a notice on this screen). '
          'Continued use of the app after an update means you accept the '
          'revised policy.',
        ),
      ],
    ),
    PrivacyPolicySection(
      title: '19. Contact Information',
      blocks: [
        PolicyParagraph(
          'For any question about this policy or your data, or to make a '
          'privacy-related request:',
        ),
        PolicyBullets([
          'App operator: [legal name — pending confirmation].',
          'Contact email: [pending confirmation].',
          'Privacy-requests email: [pending confirmation].',
          'Phone / WhatsApp: [pending confirmation].',
          'Address: [pending confirmation, if applicable].',
          'Operating region: Syria (Latakia initially). [pending confirmation.]',
        ]),
        PolicyParagraph(
          'You can also use the in-app support contact option.',
        ),
      ],
    ),
  ];
}
