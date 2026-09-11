import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/constants/app_padding.dart';
import 'package:feniq/core/theme/dark_theme.dart';
import 'package:feniq/core/theme/light_theme.dart';
import 'package:feniq/core/widgets/quantity_stepper.dart';
import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/cart/presentation/widgets/cart_item_tile.dart';
import 'package:feniq/features/exchange_rate/data/models/exchange_rate_model.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:feniq/generated/app_localizations.dart';

class _MockExchangeRateRepository extends Mock implements ExchangeRateRepository {}

const _item = CartItem(
  productId: 'p1',
  nameAr: 'دواء',
  nameEn: 'Med',
  manufacturerAr: 'شركة',
  manufacturerEn: 'Co',
  unitPriceUsd: 10,
  discountPriceUsd: 10,
  quantity: 3,
);

void main() {
  late _MockExchangeRateRepository rateRepository;
  late ExchangeRateCubit rateCubit;

  setUp(() {
    rateRepository = _MockExchangeRateRepository();
    rateCubit = ExchangeRateCubit(exchangeRateRepository: rateRepository);
  });
  tearDown(() => rateCubit.close());

  Future<void> pumpTile(
    WidgetTester tester, {
    required CartItem item,
    ValueChanged<int>? onQuantityChanged,
    VoidCallback? onRemove,
    Locale? locale,
    ThemeMode themeMode = ThemeMode.light,
  }) {
    return tester.pumpWidget(
      MaterialApp(
        locale: locale,
        theme: LightTheme.data,
        darkTheme: DarkTheme.data,
        themeMode: themeMode,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<ExchangeRateCubit>.value(
          value: rateCubit,
          child: Scaffold(
            // Hosted the way CartView hosts it: a padded, scrolling column.
            body: SingleChildScrollView(
              padding: AppPadding.screen,
              child: CartItemTile(
                item: item,
                onQuantityChanged: onQuantityChanged ?? (_) {},
                onRemove: onRemove ?? () {},
              ),
            ),
          ),
        ),
      ),
    );
  }

  CartItem packageLine({required bool isAvailable}) => CartItem.fromPackage(
        packageId: 'ad1',
        titleAr: 'باقة',
        titleEn: 'Package',
        warehouseName: 'Warehouse',
        pricePerCopyUsd: 40,
        copies: 1,
        contents: const [],
        isAvailable: isAvailable,
      );

  testWidgets('an unavailable package line shows the warning banner', (tester) async {
    await pumpTile(tester, item: packageLine(isAvailable: false));

    final l10n = AppLocalizations.of(tester.element(find.byType(CartItemTile)))!;
    expect(find.text(l10n.packageUnavailableBanner), findsOneWidget);
    // Still removable - the banner warns, it doesn't take the controls away.
    expect(find.byType(QuantityStepper), findsOneWidget);
    expect(find.byIcon(Icons.delete_outline), findsOneWidget);
  });

  testWidgets('an available package line shows no warning', (tester) async {
    await pumpTile(tester, item: packageLine(isAvailable: true));

    final l10n = AppLocalizations.of(tester.element(find.byType(CartItemTile)))!;
    expect(find.text(l10n.packageUnavailableBanner), findsNothing);
  });

  testWidgets('displays the real quantity from the cart item', (tester) async {
    await pumpTile(tester, item: _item);

    expect(find.byType(QuantityStepper), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
  });

  testWidgets('+ asks the cart for quantity + 1', (tester) async {
    int? requested;
    await pumpTile(tester, item: _item, onQuantityChanged: (q) => requested = q);

    await tester.tap(find.byIcon(Icons.add));
    expect(requested, 4);
  });

  testWidgets('- above 1 asks the cart for quantity - 1', (tester) async {
    int? requested;
    await pumpTile(tester, item: _item, onQuantityChanged: (q) => requested = q);

    await tester.tap(find.byIcon(Icons.remove));
    expect(requested, 2);
  });

  testWidgets('typing a large quantity is passed straight to the cart', (tester) async {
    int? requested;
    await pumpTile(tester, item: _item, onQuantityChanged: (q) => requested = q);

    await tester.enterText(find.byType(TextField), '250');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();

    expect(requested, 250);
  });

  testWidgets('- at quantity 1 confirms removal instead of dropping to 0', (tester) async {
    int? requested;
    var removed = false;
    await pumpTile(
      tester,
      item: _item.copyWith(quantity: 1),
      onQuantityChanged: (q) => requested = q,
      onRemove: () => removed = true,
    );

    await tester.tap(find.byIcon(Icons.remove));
    await tester.pumpAndSettle();

    expect(requested, isNull, reason: 'never emits quantity 0');
    expect(find.byType(AlertDialog), findsOneWidget);

    await tester.tap(find.text('Remove'));
    await tester.pumpAndSettle();
    expect(removed, isTrue);
  });

  testWidgets('the trash button still opens the same remove confirmation', (tester) async {
    var removed = false;
    await pumpTile(tester, item: _item, onRemove: () => removed = true);

    await tester.tap(find.byIcon(Icons.delete_outline));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);

    await tester.tap(find.text('Remove'));
    await tester.pumpAndSettle();
    expect(removed, isTrue);
  });

  // The tile grew - a larger picture and type, the full-size stepper. A phone
  // is far narrower than the default test surface, Arabic runs longer and
  // right-to-left, and a RenderFlex overflow surfaces as a test exception, so
  // these pin that the bigger tile still fits where it actually has to.
  group('narrow screens, RTL and dark mode', () {
    const offerLine = CartItem(
      productId: 'p2',
      nameAr: 'بنادول إكسترا أقراص مغلفة ٥٠٠ ملغ عبوة كبيرة للصيدليات',
      nameEn: 'Panadol Extra coated tablets 500mg large pharmacy pack',
      manufacturerAr: 'شركة الأدوية المتحدة للصناعات الدوائية',
      unitPriceUsd: 100,
      discountPriceUsd: 80,
      quantity: 250,
    );
    final bigPackage = CartItem.fromPackage(
      packageId: 'ad2',
      titleAr: 'باقة الشتاء العائلية الكبيرة للأدوية الأساسية',
      titleEn: 'The big family winter package of essential medicines',
      warehouseName: 'مستودع النور للأدوية',
      pricePerCopyUsd: 1250,
      copies: 12,
      contents: const [
        CartPackageContent(
          productId: 'p1',
          nameAr: 'بنادول إكسترا ٥٠٠ ملغ',
          nameEn: 'Panadol Extra 500mg',
          quantityPerCopy: 24,
        ),
      ],
      isAvailable: false,
    );

    for (final themeMode in [ThemeMode.light, ThemeMode.dark]) {
      for (final (label, item) in [('discounted product', offerLine), ('package', bigPackage)]) {
        testWidgets('a $label line fits a 360pt phone in Arabic, ${themeMode.name} mode', (
          tester,
        ) async {
          tester.view.physicalSize = const Size(360, 800);
          tester.view.devicePixelRatio = 1.0;
          addTearDown(tester.view.reset);
          when(() => rateRepository.getExchangeRate())
              .thenAnswer((_) async => ExchangeRateModel(usdToSyp: 15000));
          await rateCubit.load();

          await pumpTile(tester, item: item, locale: const Locale('ar'), themeMode: themeMode);

          expect(find.byType(QuantityStepper), findsOneWidget);
          expect(tester.takeException(), isNull);
        });
      }
    }
  });
}
