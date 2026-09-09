import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/widgets/primary_button.dart';
import 'package:feniq/features/cart/data/models/order_line_item.dart';
import 'package:feniq/features/cart/data/models/order_model.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/returns/data/models/return_model.dart';
import 'package:feniq/features/returns/data/repositories/return_repository.dart';
import 'package:feniq/features/returns/presentation/widgets/request_return_sheet.dart';
import 'package:feniq/generated/app_localizations.dart';

// Section 6.9: the photo is optional. This is the UI half of that rule -
// request_return_cubit_test.dart already covers the validation logic, this
// covers what the pharmacist actually sees and taps: the label says
// "optional", nothing marks the photo field as required, and the submit
// button really does fire with zero photos attached.
class MockReturnRepository extends Mock implements ReturnRepository {}

class MockOrderRepository extends Mock implements OrderRepository {}

OrderLineItem _line(String id) => OrderLineItem(
  id: id,
  productId: 'p_$id',
  productNameAr: 'دواء $id',
  productNameEn: 'Medicine $id',
  manufacturerAr: 'شركة',
  quantity: 5,
  unitPrice: 100,
  discountPrice: 100,
  lineTotal: 500,
);

OrderModel _order() => OrderModel(
  id: 'o1',
  orderNumber: 1,
  status: 'delivered',
  totalPrice: 0,
  discountAmount: 0,
  commissionAmount: 0,
  finalPrice: 0,
  items: [_line('a'), _line('b')],
);

ReturnModel _return() => ReturnModel(
  id: 'r1',
  orderId: 'o1',
  items: const [],
  status: 'pending',
  createdAt: DateTime(2026, 1, 1),
);

void main() {
  setUpAll(() {
    registerFallbackValue(<ReturnItemInput>[]);
    registerFallbackValue(<XFile>[]);
  });

  late MockReturnRepository returnRepo;
  late MockOrderRepository orderRepo;

  setUp(() {
    returnRepo = MockReturnRepository();
    orderRepo = MockOrderRepository();
    when(() => orderRepo.getOrder(any())).thenAnswer((_) async => _order());
    when(
      () => returnRepo.createReturn(
        orderId: any(named: 'orderId'),
        items: any(named: 'items'),
        notes: any(named: 'notes'),
        images: any(named: 'images'),
      ),
    ).thenAnswer((_) async => _return());
  });

  // Opens the sheet the same way the Returns page does - through
  // showRequestReturnSheet, so the repositories come off the widget tree.
  Future<void> openSheet(WidgetTester tester, {Locale locale = const Locale('en')}) async {
    await tester.pumpWidget(
      MultiRepositoryProvider(
        providers: [
          RepositoryProvider<ReturnRepository>.value(value: returnRepo),
          RepositoryProvider<OrderRepository>.value(value: orderRepo),
        ],
        child: MaterialApp(
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Builder(
            builder: (context) => Scaffold(
              body: ElevatedButton(
                onPressed: () => showRequestReturnSheet(context, orderId: 'o1'),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets('the photo field is labelled optional and carries no required marker', (tester) async {
    await openSheet(tester);

    expect(find.text('Photos (optional)'), findsOneWidget);
    expect(
      find.textContaining('Optionally add photos'),
      findsOneWidget,
      reason: 'the hint invites a photo, it does not demand one',
    );
    // Nothing in the sheet may claim a photo is needed - neither an asterisk
    // on the label nor any copy carrying the old requirement.
    expect(find.text('Photos *'), findsNothing);
    expect(find.textContaining('at least one photo'), findsNothing);
  });

  testWidgets('the submit button is enabled with an item picked and zero photos', (tester) async {
    await openSheet(tester);

    await tester.tap(find.text('Medicine a'));
    await tester.pumpAndSettle();

    final button = tester.widget<PrimaryButton>(
      find.widgetWithText(PrimaryButton, 'Submit return request'),
    );
    expect(button.onPressed, isNotNull, reason: 'an empty photo selection must not disable submit');
    expect(button.isLoading, isFalse);
  });

  testWidgets('tapping submit with no photo attached actually creates the return', (tester) async {
    await openSheet(tester);

    await tester.tap(find.text('Medicine a'));
    await tester.pumpAndSettle();

    // The sheet scrolls; the button sits below the fold in the test viewport.
    final submit = find.text('Submit return request');
    await tester.ensureVisible(submit);
    await tester.pumpAndSettle();
    await tester.tap(submit);
    await tester.pumpAndSettle();

    final captured = verify(
      () => returnRepo.createReturn(
        orderId: 'o1',
        items: captureAny(named: 'items'),
        notes: any(named: 'notes'),
        images: captureAny(named: 'images'),
      ),
    ).captured;
    expect((captured[0] as List<ReturnItemInput>).single.orderItemId, 'a');
    expect(captured[1] as List<XFile>, isEmpty);
    // The sheet closes on success, which is what the caller reads the new
    // return off of - a blocked submit would have left it open.
    expect(find.text('Request a return'), findsNothing);
  });

  testWidgets('the Arabic copy does not ask for a photo either', (tester) async {
    await openSheet(tester, locale: const Locale('ar'));

    expect(find.text('صور (اختياري)'), findsOneWidget);
    expect(find.textContaining('صورة واحدة على الأقل'), findsNothing);
  });
}
