import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/core/theme/dark_theme.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/core/widgets/status_badge.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/data/models/returnable_order_model.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_cubit.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_state.dart';
import 'package:phoenix/features/returns/presentation/views/my_returns_view.dart';
import 'package:phoenix/features/returns/presentation/widgets/return_list_tile.dart';
import 'package:phoenix/generated/app_localizations.dart';

// A pure UI test suite for the Returns page. It never asserts on business
// logic - only that every visual state renders correctly, that the two
// sections are shown as switchable tabs, and that the existing FAB flow is
// still wired up.
class MockMyReturnsCubit extends MockCubit<MyReturnsState> implements MyReturnsCubit {}

class MockReturnRepository extends Mock implements ReturnRepository {}

class MockOrderRepository extends Mock implements OrderRepository {}

ReturnItemModel _item(String name) => ReturnItemModel(
  orderItemId: 'oi-$name',
  productId: 'p-$name',
  quantity: 1,
  reasonType: 'damaged',
  productNameAr: 'دواء $name',
  productNameEn: 'Medicine $name',
);

ReturnModel _return({
  String id = 'r1',
  String status = 'pending',
  int? orderNumber = 900,
  String? rejectionNote,
}) => ReturnModel(
  id: id,
  orderId: 'o-$id',
  items: [_item('A'), _item('B')],
  status: status,
  rejectionNote: rejectionNote,
  createdAt: DateTime(2026, 1, 5, 10, 30),
  orderNumber: orderNumber,
);

ReturnableOrderModel _returnable(String id, int number, {int hoursRemaining = 40}) => ReturnableOrderModel(
  id: id,
  orderNumber: number,
  warehouseId: 'w1',
  warehouseNameAr: 'مستودع النجاح',
  warehouseNameEn: 'Al-Najah',
  finalPrice: 125000,
  deliveredAt: DateTime(2026, 1, 1),
  hoursRemaining: hoursRemaining,
  items: const [],
);

void main() {
  late MockMyReturnsCubit cubit;

  setUp(() {
    cubit = MockMyReturnsCubit();
    when(() => cubit.load()).thenAnswer((_) async {});
    when(() => cubit.loadMore()).thenAnswer((_) async {});
  });

  Future<void> pump(
    WidgetTester tester, {
    required MyReturnsState state,
    Locale locale = const Locale('en'),
    ThemeData? theme,
    bool settle = true,
  }) async {
    when(() => cubit.state).thenReturn(state);
    await tester.pumpWidget(
      MultiRepositoryProvider(
        providers: [
          RepositoryProvider<ReturnRepository>.value(value: MockReturnRepository()),
          RepositoryProvider<OrderRepository>.value(value: MockOrderRepository()),
        ],
        child: MaterialApp(
          locale: locale,
          theme: theme,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: BlocProvider<MyReturnsCubit>.value(value: cubit, child: const MyReturnsView()),
        ),
      ),
    );
    if (settle) {
      await tester.pumpAndSettle();
    } else {
      await tester.pump();
    }
  }

  const loaded = MyReturnsStatus.loaded;

  // Opens the "Orders eligible for return" tab.
  Future<void> openEligibleTab(WidgetTester tester) async {
    await tester.tap(find.text('Orders eligible for return'));
    await tester.pumpAndSettle();
  }

  testWidgets('1. the Returns page still renders, with the two-tab selector', (tester) async {
    await pump(tester, state: MyReturnsState(status: loaded, returns: [_return()]));

    expect(find.byType(MyReturnsView), findsOneWidget);
    expect(find.text('Returns'), findsOneWidget); // app bar title
    expect(find.byType(TabBar), findsOneWidget);
    expect(find.text('Your return requests'), findsOneWidget); // tab 1 label
    expect(find.text('Orders eligible for return'), findsOneWidget); // tab 2 label
  });

  testWidgets('2. the first tab shows the existing returns with their status', (tester) async {
    await pump(
      tester,
      state: MyReturnsState(
        status: loaded,
        returns: [
          _return(id: 'r1', status: 'pending'),
          _return(id: 'r2', status: 'approved', orderNumber: 901),
        ],
      ),
    );

    // Tab 1 is selected by default.
    expect(find.byType(ReturnListTile), findsNWidgets(2));
    expect(find.byType(StatusBadge), findsNWidgets(2));
    expect(find.text('Pending review'), findsOneWidget);
    expect(find.text('Approved'), findsOneWidget);
    expect(find.textContaining('Medicine A'), findsWidgets);
  });

  testWidgets('3. the second tab shows the eligible orders', (tester) async {
    await pump(
      tester,
      state: MyReturnsState(
        status: loaded,
        returnableOrders: [_returnable('o1', 1001)],
      ),
    );

    // Content lives on the second tab - not visible until it is opened.
    expect(find.text('Order #1001'), findsNothing);

    await openEligibleTab(tester);

    expect(find.text('Order #1001'), findsOneWidget);
    expect(find.textContaining('Delivered'), findsOneWidget);
    expect(find.text('Request a return'), findsOneWidget);
  });

  testWidgets('4. switching tabs hides the other tab\'s content', (tester) async {
    await pump(
      tester,
      state: MyReturnsState(
        status: loaded,
        returns: [_return()],
        returnableOrders: [_returnable('o1', 1001)],
      ),
    );

    // Default: tab 1 content shown, tab 2 content hidden.
    expect(find.byType(ReturnListTile), findsOneWidget);
    expect(find.text('Order #1001'), findsNothing);

    await openEligibleTab(tester);

    // Now reversed.
    expect(find.byType(ReturnListTile), findsNothing);
    expect(find.text('Order #1001'), findsOneWidget);
  });

  testWidgets('5. the Request Return FAB is present', (tester) async {
    await pump(tester, state: const MyReturnsState(status: loaded));

    expect(find.byType(FloatingActionButton), findsOneWidget);
    expect(
      find.descendant(of: find.byType(FloatingActionButton), matching: find.text('Request Return')),
      findsOneWidget,
    );
  });

  testWidgets('6. the FAB still triggers the existing request-return flow', (tester) async {
    await pump(
      tester,
      state: MyReturnsState(
        status: loaded,
        returnableOrders: [_returnable('o1', 1001), _returnable('o2', 1002)],
      ),
    );

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();

    // The unchanged picker sheet the FAB opens when there is more than one
    // eligible order.
    expect(find.text('Select the order you want to return items from'), findsOneWidget);
    expect(find.widgetWithText(ListTile, 'Order #1001'), findsOneWidget);
    expect(find.widgetWithText(ListTile, 'Order #1002'), findsOneWidget);
  });

  testWidgets('7. tab 1 empty state renders an icon, title, hint and a CTA', (tester) async {
    await pump(tester, state: const MyReturnsState(status: loaded));

    expect(find.text("You haven't requested any returns yet."), findsOneWidget);
    expect(
      find.text(
        'Once you request a return on a delivered order, it will show up here so you can follow its status.',
      ),
      findsOneWidget,
    );
    expect(find.byIcon(Icons.assignment_return_outlined), findsOneWidget);
    // The empty-state CTA plus the FAB both offer the "Request Return" action.
    expect(find.text('Request Return'), findsNWidgets(2));
  });

  testWidgets('8. tab 2 empty state renders its own message', (tester) async {
    await pump(tester, state: const MyReturnsState(status: loaded));

    await openEligibleTab(tester);

    expect(find.text('No orders eligible for return'), findsOneWidget);
  });

  testWidgets('9. the loading state renders skeleton cards, not a bare spinner', (tester) async {
    await pump(
      tester,
      state: const MyReturnsState(status: MyReturnsStatus.loading),
      settle: false,
    );

    expect(find.byKey(const ValueKey('returnsLoadingSkeleton')), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.byType(ReturnListTile), findsNothing);
    expect(find.byType(TabBar), findsNothing); // no tabs during the first load
  });

  testWidgets('10. the error state renders the shared FailureWidget with retry', (tester) async {
    await pump(
      tester,
      state: const MyReturnsState(
        status: MyReturnsStatus.error,
        errorMessage: 'Boom',
        errorCode: 'SOME_CODE',
      ),
    );

    expect(find.byType(FailureWidget), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pump();
    verify(() => cubit.load()).called(1);
  });

  testWidgets('11. renders correctly in Arabic (RTL)', (tester) async {
    await pump(
      tester,
      locale: const Locale('ar'),
      state: MyReturnsState(status: loaded, returns: [_return()], returnableOrders: [_returnable('o1', 1001)]),
    );

    expect(find.text('المرتجعات'), findsOneWidget); // app bar title
    expect(find.text('طلبات الإرجاع الخاصة بك'), findsOneWidget); // tab 1 label
    expect(find.text('طلبات مؤهلة للإرجاع'), findsOneWidget); // tab 2 label
    expect(Directionality.of(tester.element(find.byType(ReturnListTile).first)), TextDirection.rtl);
  });

  testWidgets('12. renders in dark mode without error', (tester) async {
    await pump(
      tester,
      theme: DarkTheme.data,
      state: MyReturnsState(
        status: loaded,
        returns: [_return(status: 'rejected', rejectionNote: 'Damaged on arrival')],
        returnableOrders: [_returnable('o1', 1001, hoursRemaining: 4)],
      ),
    );

    expect(tester.takeException(), isNull);
    expect(find.byType(MyReturnsView), findsOneWidget);
    // Tab 1 content.
    expect(find.byType(ReturnListTile), findsOneWidget);
    expect(find.text('Rejected'), findsOneWidget); // status badge on the return
    expect(find.textContaining('Damaged on arrival'), findsOneWidget); // rejection note

    // Tab 2 content.
    await openEligibleTab(tester);
    expect(tester.takeException(), isNull);
    expect(find.text('Ending soon'), findsOneWidget); // urgency badge on the 4h-left order
  });

  testWidgets('13. both tabs are always labelled, regardless of content', (tester) async {
    await pump(
      tester,
      state: MyReturnsState(
        status: loaded,
        returns: [_return()],
        returnableOrders: [_returnable('o1', 1001)],
      ),
    );

    expect(find.text('Your return requests'), findsOneWidget);
    expect(find.text('Orders eligible for return'), findsOneWidget);
  });
}
