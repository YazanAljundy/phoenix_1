import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/returns/data/models/returnable_order_model.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_cubit.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_state.dart';
import 'package:phoenix/features/returns/presentation/views/my_returns_view.dart';
import 'package:phoenix/generated/app_localizations.dart';

class MockMyReturnsCubit extends MockCubit<MyReturnsState> implements MyReturnsCubit {}

class MockReturnRepository extends Mock implements ReturnRepository {}

class MockOrderRepository extends Mock implements OrderRepository {}

ReturnableOrderModel _returnable(String id, int number) => ReturnableOrderModel(
  id: id,
  orderNumber: number,
  warehouseId: 'w1',
  warehouseNameAr: 'مستودع النجاح',
  warehouseNameEn: 'Al-Najah',
  finalPrice: 125000,
  deliveredAt: DateTime(2026, 1, 1),
  hoursRemaining: 40,
  items: const [],
);

void main() {
  late MockMyReturnsCubit cubit;

  setUp(() {
    cubit = MockMyReturnsCubit();
    when(() => cubit.load()).thenAnswer((_) async {});
    when(() => cubit.loadMore()).thenAnswer((_) async {});
  });

  Future<void> pump(WidgetTester tester, {bool settle = true}) async {
    await tester.pumpWidget(
      MultiRepositoryProvider(
        providers: [
          RepositoryProvider<ReturnRepository>.value(value: MockReturnRepository()),
          RepositoryProvider<OrderRepository>.value(value: MockOrderRepository()),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: BlocProvider<MyReturnsCubit>.value(value: cubit, child: const MyReturnsView()),
        ),
      ),
    );
    // The first-load body is an infinite CircularProgressIndicator, so
    // pumpAndSettle would time out - callers in that state pass settle: false.
    if (settle) {
      await tester.pumpAndSettle();
    } else {
      await tester.pump();
    }
  }

  testWidgets('Test 8: "Request Return" is shown as a FloatingActionButton', (tester) async {
    when(() => cubit.state).thenReturn(const MyReturnsState(status: MyReturnsStatus.loaded));
    await pump(tester);

    expect(find.byType(FloatingActionButton), findsOneWidget);
    expect(
      find.descendant(of: find.byType(FloatingActionButton), matching: find.text('Request Return')),
      findsOneWidget,
    );
  });

  testWidgets('the FAB is hidden during the very first load', (tester) async {
    when(() => cubit.state).thenReturn(const MyReturnsState(status: MyReturnsStatus.loading));
    await pump(tester, settle: false);

    expect(find.byType(FloatingActionButton), findsNothing);
  });

  testWidgets('Test 9: tapping it with no eligible orders explains why', (tester) async {
    when(() => cubit.state).thenReturn(const MyReturnsState(status: MyReturnsStatus.loaded));
    await pump(tester);

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();

    expect(find.text('No delivered orders are currently eligible for a return.'), findsOneWidget);
  });

  testWidgets('Test 9: tapping it with several eligible orders opens the order picker', (tester) async {
    when(() => cubit.state).thenReturn(
      MyReturnsState(
        status: MyReturnsStatus.loaded,
        returnableOrders: [_returnable('o1', 1001), _returnable('o2', 1002)],
      ),
    );
    await pump(tester);

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();

    // The picker sheet (ListTiles) is distinct from the eligible-orders
    // section already in the body (cards).
    expect(find.text('Select the order you want to return items from'), findsOneWidget);
    expect(find.widgetWithText(ListTile, 'Order #1001'), findsOneWidget);
    expect(find.widgetWithText(ListTile, 'Order #1002'), findsOneWidget);
  });
}
